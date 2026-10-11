import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import passport from "passport";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import OpenAI from "openai";
import { db } from "./db";
import { runs } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import {
  checkLLMHealth,
  runTailorPipeline,
  runDryRunCheck,
  runFastDryRun,
  renderCV,
  revertRewrite,
  parseJobDescription,
  composeCVDocument,
  type OptimizationReport,
} from "./tailoring-engine";
import { createUser, getUserByEmail } from "./auth";
import { resolveJobInput } from "./job-input";
import { createLlmClient, completeJson, LLM_MODELS } from "./llm";
import { ANGLES, CV_LANGUAGES, variantInputSchema, type User } from "@shared/schema";
import { validateVariant } from "./engine/variants";
import { assembleCv, buildAssemblyReport } from "./assembler";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "Unauthorized" });
}

const openai: OpenAI | null = createLlmClient();

// Schémas des réponses LLM des routes bibliothèque (forme garantie, sinon repli explicite).
const str = z.string();
const strList = z.array(z.union([z.string(), z.number()]).transform(String));
const IMPORT_SCHEMA = z.object({
  experiences: z.array(z.object({
    title: str.optional(), company: str.optional(),
    startDate: str.nullable().optional(), endDate: str.nullable().optional(),
    description: str.nullable().optional(), bullets: strList.optional(),
  })).default([]),
});
const SKILLS_SCHEMA = z.object({ skills: z.array(z.object({ name: str, category: str.optional() })).default([]) });
const AXES_SCHEMA = z.object({ axes: z.array(z.object({ text: str, source: str.optional() })).default([]) });
const GAPS_SCHEMA = z.object({
  gaps: z.array(z.object({ id: str.optional(), dimension: str.optional(), question: str, priority: z.number().optional() })).default([]),
});
const CRITERIA = ["clarte", "contexte", "scope", "impact", "completude"] as const;
const TAG_EVAL_SCHEMA = z.object({
  tags: strList.default([]),
  evaluation: z.object(Object.fromEntries(CRITERIA.map(c => [c, z.boolean()])) as Record<typeof CRITERIA[number], z.ZodBoolean>).nullable().optional(),
  reasons: z.record(z.string()).nullable().optional(),
  suggestion: str.nullable().optional(),
});

function embeddingStoreFor(userId: number) {
  return {
    load: () => storage.getBulletEmbeddings(userId),
    save: (entries: { id: string; key: string; vector: number[] }[]) => storage.saveBulletEmbeddings(entries),
  };
}

function uid(req: Request): number {
  return (req.user as User).id;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {


  // ── AUTH RATE LIMITING (in-memory, zero dependency) ────────────────────────
  const authRateLimits = new Map<string, { count: number; windowStart: number }>();
  const RATE_LIMITS = {
    login:    { max: 5, windowMs: 15 * 60 * 1000 },   // 5 per 15 min
    register: { max: 3, windowMs: 60 * 60 * 1000 },   // 3 per 60 min
  } as const;

  function checkRateLimit(ip: string, action: "login" | "register"): boolean {
    const key = `${action}:${ip}`;
    const limit = RATE_LIMITS[action];
    const now = Date.now();
    const entry = authRateLimits.get(key);
    if (!entry || now - entry.windowStart > limit.windowMs) {
      authRateLimits.set(key, { count: 1, windowStart: now });
      return true; // allowed
    }
    entry.count++;
    return entry.count <= limit.max;
  }

  function resetRateLimit(ip: string, action: "login" | "register"): void {
    authRateLimits.delete(`${action}:${ip}`);
  }

  // Cleanup stale entries every 30 min
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of authRateLimits) {
      const action = key.startsWith("login:") ? "login" : "register";
      if (now - entry.windowStart > RATE_LIMITS[action].windowMs) authRateLimits.delete(key);
    }
  }, 30 * 60 * 1000);

  // ── AUTH ROUTES (public) ──────────────────────────────────────────────────
  app.post("/api/auth/register", async (req, res) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit(ip, "register")) {
        return res.status(429).json({ error: "Trop de tentatives d'inscription. Reessaie dans une heure." });
      }

      const { email, password, inviteCode } = req.body;

      // Invite code gate (if INVITE_CODE env var is set)
      const requiredCode = process.env.INVITE_CODE;
      if (requiredCode && inviteCode !== requiredCode) {
        return res.status(403).json({ error: "Code d'invitation invalide ou manquant." });
      }

      if (!email || !password || password.length < 8) {
        return res.status(400).json({ error: "Email et mot de passe (min 8 caracteres) requis." });
      }

      // Password complexity: 1 uppercase, 1 lowercase, 1 digit
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
      if (!passwordRegex.test(password)) {
        return res.status(400).json({ error: "Le mot de passe doit contenir au moins 1 majuscule, 1 minuscule et 1 chiffre." });
      }

      const existing = await getUserByEmail(email);
      if (existing) return res.status(409).json({ error: "Un compte existe deja avec cet email." });
      const user = await createUser(email, password);
      req.login(user, (err) => {
        if (err) return res.status(500).json({ error: "Erreur lors de la connexion." });
        res.json({ id: user.id, email: user.email });
      });
    } catch (err) {
      res.status(500).json({ error: "Erreur serveur." });
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!checkRateLimit(ip, "login")) {
      return res.status(429).json({ error: "Trop de tentatives de connexion. Reessaie dans 15 minutes." });
    }

    passport.authenticate("local", (err: unknown, user: Express.User | false, info: { message?: string } | undefined) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ error: info?.message || "Identifiants incorrects." });

      // Session regeneration to prevent session fixation
      req.session.regenerate((regenErr) => {
        if (regenErr) return next(regenErr);
        req.login(user, (loginErr) => {
          if (loginErr) return next(loginErr);
          resetRateLimit(ip, "login");
          const u = user as { id: number; email: string };
          res.json({ id: u.id, email: u.email });
        });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie("connect.sid").json({ ok: true });
      });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const u = req.user as { id: number; email: string };
    res.json({ id: u.id, email: u.email });
  });

  // ── PROTECT ALL OTHER /api ROUTES ─────────────────────────────────────────
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/auth")) return next(); // already handled above
    requireAuth(req, res, next);
  });

  app.get("/api/llm/health", async (_req, res) => {
    const result = await checkLLMHealth(openai);
    res.status(result.success ? 200 : 503).json(result);
  });

  // CV IMPORT — PDF (base64) or text paste → parse ALL experiences
  app.post("/api/import/cv", async (req, res) => {
    try {
      let rawText = "";

      if (req.body?.fileBase64) {
        // PDF sent as base64
        try {
          const pdfParse = (await import("pdf-parse")).default;
          const buffer = Buffer.from(req.body.fileBase64, "base64");
          console.log("[IMPORT] PDF buffer size:", buffer.length);
          const data = await pdfParse(buffer);
          rawText = data.text || "";
          console.log("[IMPORT] PDF text extracted:", rawText.length, "chars");
          console.log("[IMPORT] First 200 chars:", rawText.slice(0, 200));
        } catch (pdfErr: any) {
          console.error("[IMPORT] PDF parse error:", pdfErr.message);
          return res.status(400).json({ message: "Impossible de lire ce PDF. Essayez de coller le texte directement." });
        }
      } else if (req.body?.text) {
        rawText = req.body.text;
      } else {
        return res.status(400).json({ message: "Envoyez un fichier PDF (base64) ou du texte." });
      }

      // Clean up extracted text
      rawText = rawText.replace(/\s+/g, " ").trim();

      if (rawText.length < 20) {
        return res.status(400).json({ message: "Pas assez de contenu extrait. Essayez de coller le texte de votre CV directement." });
      }

      // Truncate to avoid token limits
      const truncated = rawText.slice(0, 8000);

      if (!openai) {
        return res.status(500).json({ message: "Service IA non configuré (OPENAI_API_KEY manquant)." });
      }

      const prompt = `Analyse ce CV et extrais TOUTES les expériences professionnelles.

Pour chaque expérience, extrais :
- title : intitulé du poste
- company : nom de l'entreprise
- startDate : date de début au format YYYY-MM-DD (estime si besoin, ex: "2020" → "2020-01-01")
- endDate : date de fin au format YYYY-MM-DD (null si poste actuel)
- description : résumé court du rôle en 1-2 phrases
- bullets : liste des réalisations/responsabilités (chaque bullet = une ligne du CV)

Réponds UNIQUEMENT en JSON valide, sans markdown ni backticks :
{
  "experiences": [
    {
      "title": "...",
      "company": "...",
      "startDate": "...",
      "endDate": "..." ou null,
      "description": "...",
      "bullets": ["...", "..."]
    }
  ]
}

CV à analyser :
${truncated}`;

      const parsed = await completeJson(openai, {
        model: LLM_MODELS.fast,
        messages: [{ role: "user", content: prompt }],
        schema: IMPORT_SCHEMA,
        temperature: 0.3,
      });

      const experiences = parsed.experiences || [];
      console.log("[IMPORT] Parsed", experiences.length, "experiences");

      res.json({ experiences, rawTextLength: rawText.length });
    } catch (err: any) {
      console.error("[IMPORT] Error:", err.message);
      res.status(500).json({ message: "Erreur lors de l'import: " + err.message });
    }
  });

  // Bulk create experiences from import
  app.post("/api/import/save", async (req, res) => {
    try {
      const { experiences: exps } = req.body;
      if (!exps || !Array.isArray(exps)) {
        return res.status(400).json({ message: "experiences array required" });
      }
      const userId = uid(req);
      const created = [];
      for (const exp of exps) {
        const newExp = await storage.createExperience(userId, {
          title: exp.title || "Sans titre",
          company: exp.company || "Non renseigné",
          startDate: exp.startDate || undefined,
          endDate: exp.endDate || undefined,
          description: exp.description || "",
        });

        if (exp.bullets && Array.isArray(exp.bullets)) {
          for (const bulletText of exp.bullets) {
            if (bulletText.trim()) {
              await storage.createBullet(userId, {
                experienceId: newExp.id,
                text: bulletText.trim(),
                tags: [],
              });
            }
          }
        }

        created.push(newExp);
      }

      res.status(201).json({ created: created.length });
    } catch (err: any) {
      console.error("[IMPORT] Save error:", err.message);
      res.status(500).json({ message: "Erreur lors de la sauvegarde." });
    }
  });

  // Experiences
  app.get(api.experiences.list.path, async (req, res) => {
    const exps = await storage.getExperiences(uid(req));
    res.json(exps);
  });
  app.get(api.experiences.get.path, async (req, res) => {
    const exp = await storage.getExperience(uid(req), req.params.id);
    if (!exp) return res.status(404).json({ message: "Not found" });
    res.json(exp);
  });
  app.post(api.experiences.create.path, async (req, res) => {
    try {
      const input = api.experiences.create.input.parse(req.body);
      const exp = await storage.createExperience(uid(req), input);
      res.status(201).json(exp);
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      throw e;
    }
  });
  app.put(api.experiences.update.path, async (req, res) => {
    try {
      const input = api.experiences.update.input.parse(req.body);
      const exp = await storage.updateExperience(uid(req), req.params.id, input);
      res.json(exp);
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      throw e;
    }
  });
  app.delete(api.experiences.delete.path, async (req, res) => {
    await storage.deleteExperience(uid(req), req.params.id);
    res.status(204).end();
  });

  // Bullets
  app.get(api.bullets.listByExperience.path, async (req, res) => {
    const b = await storage.getBulletsByExperience(uid(req), req.params.experienceId);
    res.json(b);
  });
  app.post(api.bullets.create.path, async (req, res) => {
    try {
      const input = api.bullets.create.input.parse(req.body);
      const expId = req.params.experienceId;
      const userId = uid(req);

      // Anti-duplicate: check if a very similar bullet already exists
      const existing = await storage.getBulletsByExperience(userId, expId);
      const newTextLower = input.text.toLowerCase().trim();
      const isDuplicate = existing.some(b => {
        const existingLower = b.text.toLowerCase().trim();
        // Check if first 50 chars match (likely a duplicate/reformulation)
        if (newTextLower.slice(0, 50) === existingLower.slice(0, 50)) return true;
        // Check high overlap (>80% of words in common)
        const newWords = new Set(newTextLower.split(/\s+/).filter(w => w.length > 3));
        const existingWords = new Set(existingLower.split(/\s+/).filter(w => w.length > 3));
        if (newWords.size === 0) return false;
        const overlap = [...newWords].filter(w => existingWords.has(w)).length;
        return overlap / newWords.size > 0.8;
      });

      if (isDuplicate) {
        console.log("[BULLETS] Duplicate detected, skipping:", input.text.slice(0, 60));
        return res.status(409).json({ message: "Un bullet similaire existe deja pour cette experience." });
      }

      const bullet = await storage.createBullet(userId, { ...input, experienceId: expId });
      res.status(201).json(bullet);
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      throw e;
    }
  });
  app.put(api.bullets.update.path, async (req, res) => {
    try {
      const input = api.bullets.update.input.parse(req.body);
      const bullet = await storage.updateBullet(uid(req), req.params.id, input);
      res.json(bullet);
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      throw e;
    }
  });
  app.delete(api.bullets.delete.path, async (req, res) => {
    await storage.deleteBullet(uid(req), req.params.id);
    res.status(204).end();
  });
  // ── Formulations (variantes par angle et par langue) ──
  app.get("/api/variants", async (req, res) => {
    const userId = uid(req);
    const [bulletVariantRows, profileVariantRows] = await Promise.all([
      storage.getBulletVariants(userId),
      storage.getProfileVariants(userId),
    ]);
    res.json({ bulletVariants: bulletVariantRows, profileVariants: profileVariantRows });
  });

  app.put("/api/bullets/:id/variants", async (req, res) => {
    const parsed = variantInputSchema
      .extend({ text: z.string().trim().min(40).max(220), source: z.enum(["user", "suggested"]).optional() })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Formulation invalide (angle, langue, 40 à 220 caractères)." });
    const row = await storage.upsertBulletVariant(uid(req), req.params.id, parsed.data);
    if (!row) return res.status(404).json({ message: "Bullet introuvable." });
    res.json(row);
  });

  app.delete("/api/bullet-variants/:id", async (req, res) => {
    await storage.deleteBulletVariant(uid(req), req.params.id);
    res.status(204).end();
  });

  // Propose des formulations pour les angles/langues manquants. Rien n'est
  // enregistré : l'utilisateur garde, corrige ou ignore chaque proposition.
  app.post("/api/bullets/:id/variants/suggest", async (req, res) => {
    const userId = uid(req);
    const wanted = z.object({
      targets: z.array(z.object({ angle: z.enum(ANGLES), language: z.enum(CV_LANGUAGES) })).min(1).max(8),
    }).safeParse(req.body);
    if (!wanted.success) return res.status(400).json({ message: "Cibles invalides." });
    if (!openai) return res.status(503).json({ message: "Service IA non configuré." });
    const all = await storage.getAllBullets(userId);
    const base = all.find(b => b.id === req.params.id);
    if (!base) return res.status(404).json({ message: "Bullet introuvable." });
    const exp = await storage.getExperience(userId, base.experienceId);
    try {
      const out = await completeJson(openai, {
        model: LLM_MODELS.fast,
        schema: z.object({ variants: z.array(z.object({ angle: z.string(), language: z.string(), text: z.string() })) }),
        temperature: 0,
        system: `Tu proposes d'autres formulations d'UN fait de CV, sans rien ajouter.
Règles absolues :
- Même fait, mêmes chiffres, mêmes outils, mêmes noms propres. Aucun ajout de résultat, de taille d'équipe ou de périmètre.
- Angle "ic" : met en avant la conception et la livraison. "lead" : la coordination, les standards, la vision (sans inventer de management). "consultant" : l'accompagnement et la structuration des pratiques. "manager" : le management, seulement si le fait le prouve, sinon reformule sobrement.
- Langue demandée : FR = français, EN = anglais. Une phrase, 60 à 200 caractères, commence par un verbe d'action, pas de formule creuse.`,
        user: `Poste : ${exp?.title || ""} chez ${exp?.company || ""}${exp?.description ? `\nContexte : ${exp.description.slice(0, 300)}` : ""}
Fait : ${base.text}
Formulations demandées : ${wanted.data.targets.map(t => `${t.angle}/${t.language}`).join(", ")}
Réponds en JSON : {"variants": [{"angle": "...", "language": "FR|EN", "text": "..."}]}`,
      });
      const allowed = `${exp?.title || ""} ${exp?.company || ""} ${exp?.description || ""}`;
      const proposals = out.variants
        .filter(v => wanted.data.targets.some(t => t.angle === v.angle && t.language === v.language))
        .map(v => ({ ...v, check: validateVariant(base.text, v.text, { allowedVocabulary: allowed }) }));
      res.json({
        proposals: proposals.filter(p => p.check.ok).map(({ check, ...p }) => p),
        rejected: proposals.filter(p => !p.check.ok).map(p => ({ angle: p.angle, language: p.language, reason: p.check.reason })),
      });
    } catch (err: any) {
      console.error("[VARIANTS] Suggest error:", err.message);
      res.status(502).json({ message: "Proposition indisponible pour le moment." });
    }
  });

  app.put("/api/profile/variants", async (req, res) => {
    const parsed = variantInputSchema.extend({ kind: z.enum(["title", "summary"]) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Variante de profil invalide." });
    res.json(await storage.upsertProfileVariant(uid(req), parsed.data));
  });

  app.delete("/api/profile-variants/:id", async (req, res) => {
    await storage.deleteProfileVariant(uid(req), req.params.id);
    res.status(204).end();
  });

  // All unique tags across all bullets (for autocomplete), sorted by frequency desc
  app.get("/api/bullets/tags", async (req, res) => {
    const allBullets = await storage.getAllBullets(uid(req));
    const freq = new Map<string, number>();
    allBullets.flatMap(b => b.tags || []).filter(Boolean).forEach(t => freq.set(t, (freq.get(t) || 0) + 1));
    const tags = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
    res.json(tags);
  });

  // Skills
  app.get(api.skills.list.path, async (req, res) => {
    const s = await storage.getSkills(uid(req));
    res.json(s);
  });
  app.post(api.skills.create.path, async (req, res) => {
    try {
      const input = api.skills.create.input.parse(req.body);
      const skill = await storage.createSkill(uid(req), input);
      res.status(201).json(skill);
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      throw e;
    }
  });
  app.put(api.skills.update.path, async (req, res) => {
    try {
      const input = api.skills.update.input.parse(req.body);
      const skill = await storage.updateSkill(uid(req), req.params.id, input);
      res.json(skill);
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      throw e;
    }
  });
  app.delete(api.skills.delete.path, async (req, res) => {
    await storage.deleteSkill(uid(req), req.params.id);
    res.status(204).end();
  });

  // Extract skills from all experiences + bullets via LLM
  app.post("/api/skills/extract", async (req, res) => {
    try {
      const userId = uid(req);
      const allExps = await storage.getExperiences(userId);
      const allBullets = await storage.getAllBullets(userId);
      const existingSkills = await storage.getSkills(userId);

      if (allExps.length === 0) {
        return res.status(400).json({ message: "Ajoutez des experiences d'abord." });
      }

      // Build a summary of all experiences + bullets
      const expSummaries = allExps.map(exp => {
        const expBullets = allBullets.filter(b => b.experienceId === exp.id);
        return `${exp.title} chez ${exp.company}:\n${exp.description || ""}\n${expBullets.map(b => "- " + b.text).join("\n")}`;
      }).join("\n\n");

      const existingNames = existingSkills.map(s => s.name.toLowerCase());

      if (!openai) {
        return res.json({ skills: [] });
      }

      const prompt = `Analyse ces experiences professionnelles et extrais TOUTES les competences (skills).

EXPERIENCES :
${expSummaries.slice(0, 6000)}

COMPETENCES DEJA ENREGISTREES (ne pas dupliquer) :
${existingNames.join(", ") || "aucune"}

REGLES :
- Extrais les competences explicites ET implicites
- Classe chaque competence dans UNE categorie parmi : "Outils", "Methodologies", "Soft Skills", "Domaines", "Techniques"
- "Outils" = logiciels, apps, plateformes (Figma, Jira, Salesforce...)
- "Methodologies" = methodes de travail (User Research, Design Thinking, Agile, A/B Testing...)
- "Soft Skills" = competences humaines (Leadership, Communication, Gestion de stakeholders...)
- "Domaines" = expertises metier (E-commerce, CRM, B2B, Luxury, Retail...)
- "Techniques" = competences techniques (Design System, Prototypage, Data Visualization...)
- NE PAS inclure les competences deja enregistrees
- Max 20 nouvelles competences
- Nom court (1-3 mots max)

Reponds UNIQUEMENT en JSON valide :
{
  "skills": [
    {"name": "...", "category": "Outils"},
    {"name": "...", "category": "Methodologies"}
  ]
}`;

      const result = await completeJson(openai, {
        model: LLM_MODELS.fast,
        messages: [{ role: "user", content: prompt }],
        schema: SKILLS_SCHEMA,
        temperature: 0.3,
      });

      const extracted = result.skills || [];
      // Filter out duplicates
      const filtered = extracted.filter((s: any) =>
        s.name && !existingNames.includes(s.name.toLowerCase())
      );

      console.log("[SKILLS] Extracted", filtered.length, "new skills");
      res.json({ skills: filtered });
    } catch (err: any) {
      console.error("[SKILLS] Extract error:", err.message);
      res.json({ skills: [] });
    }
  });

  // PROFILE
  app.get("/api/profile", async (req, res) => {
    const p = await storage.getProfile(uid(req));
    res.json(p || { name: "", title: "", summary: null, targetRole: null });
  });
  app.put("/api/profile", async (req, res) => {
    try {
      const p = await storage.upsertProfile(uid(req), req.body);
      res.json(p);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // FORMATIONS
  app.get("/api/formations", async (req, res) => {
    const f = await storage.getFormations(uid(req));
    res.json(f);
  });
  app.post("/api/formations", async (req, res) => {
    try {
      const { school, degree, year } = req.body;
      if (!school || !degree) return res.status(400).json({ message: "school and degree required" });
      const f = await storage.createFormation(uid(req), { school, degree, year });
      res.status(201).json(f);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  app.delete("/api/formations/:id", async (req, res) => {
    await storage.deleteFormation(uid(req), req.params.id);
    res.status(204).end();
  });

  // LANGUAGES
  app.get("/api/languages", async (req, res) => {
    const l = await storage.getLanguages(uid(req));
    res.json(l);
  });
  app.post("/api/languages", async (req, res) => {
    try {
      const { name, level } = req.body;
      if (!name) return res.status(400).json({ message: "name required" });
      const l = await storage.createLanguage(uid(req), { name, level });
      res.status(201).json(l);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  app.delete("/api/languages/:id", async (req, res) => {
    await storage.deleteLanguage(uid(req), req.params.id);
    res.status(204).end();
  });

  // SETTINGS — reset all data
  // ── SETTINGS — export user data ──
  app.get("/api/settings/export", requireAuth, async (req, res) => {
    try {
      const userId = uid(req);
      const [userProfile, userExperiences, userSkills, userFormations, userLanguages, userRuns, userBulletVariants, userProfileVariants] = await Promise.all([
        storage.getProfile(userId),
        storage.getExperiences(userId),
        storage.getSkills(userId),
        storage.getFormations(userId),
        storage.getLanguages(userId),
        storage.getRuns(userId),
        storage.getBulletVariants(userId),
        storage.getProfileVariants(userId),
      ]);
      const experiencesWithBullets = await Promise.all(
        userExperiences.map(async (exp) => ({
          ...exp,
          bullets: await storage.getBulletsByExperience(userId, exp.id),
        })),
      );
      const exportData = {
        exportedAt: new Date().toISOString(),
        profile: userProfile || null,
        experiences: experiencesWithBullets,
        bulletVariants: userBulletVariants,
        profileVariants: userProfileVariants,
        skills: userSkills,
        formations: userFormations,
        languages: userLanguages,
        runs: userRuns,
      };
      res.setHeader("Content-Disposition", `attachment; filename="cv-tai-export-${new Date().toISOString().slice(0, 10)}.json"`);
      res.setHeader("Content-Type", "application/json");
      res.json(exportData);
    } catch (err: any) {
      console.error("[SETTINGS] Export failed:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/settings/reset", async (req, res) => {
    try {
      const userId = uid(req);
      const client = await (await import("./db")).pool.connect();
      try {
        // Delete only the current user's data
        await client.query("DELETE FROM runs WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM job_posts WHERE user_id = $1", [userId]);
        await client.query(
          "DELETE FROM bullets WHERE experience_id IN (SELECT id FROM experiences WHERE user_id = $1)",
          [userId]
        );
        await client.query("DELETE FROM experiences WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM skills WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM formations WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM languages WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM profile WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM profile_variants WHERE user_id = $1", [userId]);
        console.log("[SETTINGS] Data reset for user", userId);
        res.json({ success: true });
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.error("[SETTINGS] Reset failed:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // Runs history
  app.get("/api/runs", async (req, res) => {
    const allRuns = await storage.getRuns(uid(req));
    res.json(allRuns);
  });

  // ── TRACKING — persist application tracking to DB ──
  app.patch("/api/runs/:id/tracking", async (req, res) => {
    try {
      const userId = uid(req);
      const { tracking } = req.body;
      if (!tracking || typeof tracking !== "object") {
        return res.status(400).json({ error: "tracking object required" });
      }
      await db.update(runs).set({ tracking }).where(and(eq(runs.id, req.params.id), eq(runs.userId, userId)));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[TRACKING] Error:", err.message);
      res.status(500).json({ error: "Erreur serveur." });
    }
  });

  // EXTRACT AXES — parse description + bullets into mission axes
  app.post("/api/experiences/:id/extract-axes", async (req, res) => {
    try {
      const userId = uid(req);
      const exp = await storage.getExperience(userId, req.params.id);
      if (!exp) return res.status(404).json({ message: "Experience not found" });

      const existingBullets = await storage.getBulletsByExperience(userId, exp.id);
      const bulletTexts = existingBullets.map(b => `- ${b.text}`).join("\n");

      if (!openai || (!exp.description && existingBullets.length === 0)) {
        return res.json({ axes: [] });
      }

      const prompt = `Analyse cette experience et identifie les grands AXES de mission / perimetres de travail distincts.

EXPERIENCE :
- Poste : ${exp.title}
- Entreprise : ${exp.company}
- Description : ${exp.description || "Aucune"}
${existingBullets.length > 0 ? `\nBULLETS EXISTANTS :\n${bulletTexts}` : ""}

REGLES :
- Un axe = un projet, un produit, ou un scope de responsabilite distinct (ex: "CRM B2B", "Refonte page produit", "Accompagnement UX equipes")
- Une competence transversale (design system, user research, figma) n'est PAS un axe
- Max 5 axes
- Classe-les du plus important au moins important (temps passe, impact)
- Si la description est vague ou courte, propose 2-3 axes generiques bases sur le titre du poste

Reponds en JSON : {"axes": [{"text": "description courte de l'axe", "source": "description|bullet|inferred"}]}`;

      const result = await completeJson(openai, {
        model: LLM_MODELS.fast,
        messages: [{ role: "user", content: prompt }],
        schema: AXES_SCHEMA,
        temperature: 0.3,
      });

      res.json({ axes: (result.axes || []).slice(0, 5) });
    } catch (err: any) {
      console.error("[AXES] Error:", err.message);
      res.json({ axes: [], llmError: true });
    }
  });

  // GAP DETECTION — analyze experience + bullets, find what's missing
  app.post("/api/experiences/:id/detect-gaps", async (req, res) => {
    try {
      const userId = uid(req);
      const exp = await storage.getExperience(userId, req.params.id);
      if (!exp) return res.status(404).json({ message: "Experience not found" });

      const existingBullets = await storage.getBulletsByExperience(userId, exp.id);
      const bulletTexts = existingBullets.map(b => `- ${b.text} [tags: ${(b.tags || []).join(", ")}]`).join("\n");

      if (!openai) {
        return res.json({ gaps: [
          { id: "g1", dimension: "scope", question: "Tu travaillais avec combien de personnes ?", priority: 1 },
          { id: "g2", dimension: "impact", question: "Quel resultat concret ca a donne ?", priority: 2 },
        ]});
      }

      const prompt = `Tu analyses un CV pour trouver ce qui MANQUE. Tu dois identifier les lacunes et poser UNE question par lacune.

ETAPE 1 — IDENTIFIER LES MISSIONS/PERIMETRES DISTINCTS
Regarde la description et les bullets. S'il y a plusieurs MISSIONS ou PERIMETRES de travail differents (ex: CRM + B2B, app mobile + back-office, produit client + produit interne), identifie-les.
ATTENTION : une competence transversale (design system, user research, figma) n'est PAS un perimetre distinct. Un perimetre = un projet, un produit, ou un scope de responsabilite separe.

EXPERIENCE :
- Poste : ${exp.title}
- Entreprise : ${exp.company}
- Description : ${exp.description || "Aucune"}
${existingBullets.length > 0 ? `\nBULLETS EXISTANTS :\n${bulletTexts}` : "\nAucun bullet existant."}

ETAPE 2 — TROUVER LES LACUNES
Pour CHAQUE mission/perimetre, verifie ces dimensions. PRIORISE les dimensions qui donnent des CHIFFRES :
1. SCOPE — combien ? (utilisateurs, marques, boutiques, equipe, budget)
2. IMPACT — quel resultat mesurable ? (%, temps gagne, avant/apres, adoption)
3. CONTEXTE — pourquoi ? quel probleme concret a resoudre ?
4. METHODE — comment ? quelle approche specifique ?
5. COLLABORATION — avec qui ? combien de personnes ?
6. DIFFICULTES — quelles contraintes concretes ?

REGLES :
- PRIORISE scope et impact (ce sont les dimensions qui produisent les meilleurs bullets CV)
- Si plusieurs missions, couvre TOUS les perimetres
- Max 4 questions au total
- Chaque question DEMANDE UN CHIFFRE ou UN FAIT CONCRET (pas "parle-moi de...")
- Questions en 15 mots MAX, tutoiement, ton direct
- Si tout est couvert AVEC des chiffres, retourne un tableau vide

BONS EXEMPLES :
- "Le CRM, c'est utilise par combien de marques ?" (demande un chiffre)
- "Le B2B, ca a remplace quel process ? Ca prenait combien de temps avant ?" (demande un avant/apres)
- "Tu bossais avec combien de devs et PMs sur le CRM ?" (demande un chiffre)

MAUVAIS EXEMPLES :
- "Parle-moi du CRM" (trop vague)
- "Comment c'etait ?" (pas de direction)

Reponds UNIQUEMENT en JSON valide :
{"gaps": [{"id": "g1", "dimension": "scope|impact|contexte|methode|collaboration|difficultes", "question": "...", "priority": 1}]}`;

      const result = await completeJson(openai, {
        model: LLM_MODELS.fast,
        messages: [{ role: "user", content: prompt }],
        schema: GAPS_SCHEMA,
        temperature: 0.5,
      });

      res.json(result);
    } catch (err: any) {
      console.error("[GAPS] Error:", err.message);
      res.json({ gaps: [], llmError: true });
    }
  });

  // TAG + EVALUATE — user writes bullet, LLM tags + evaluates
  app.post("/api/experiences/:id/tag-evaluate", async (req, res) => {
    try {
      const exp = await storage.getExperience(uid(req), req.params.id);
      if (!exp) return res.status(404).json({ message: "Experience not found" });

      const { text } = req.body;
      if (!text || !text.trim()) return res.status(400).json({ message: "text required" });

      if (!openai) {
        return res.json({ tags: ["general"], evaluation: null, suggestion: null });
      }

      const prompt = `Tu recois un bullet CV. Tu fais 4 choses SIMPLES :

1. TAGGER avec 3-6 mots-cles pour le matching ATS
   - Des mots SIMPLES qu'un recruteur taperait : "CRM", "B2B", "Product Design", "Figma", "User Research", "Partnership", "Loyalty"
   - PAS de mots composes avec tirets : "partnership-management" â†’ juste "Partnership"
   - PAS de termes generiques : "travail", "experience", "UX" (trop vague)
   - Specifiques au contenu reel du bullet
   
2. EVALUER sur 5 criteres (true/false)
   - clarte : comprehensible en 5 secondes ?
   - contexte : on sait pour qui/quoi/dans quel cadre ?
   - scope : ordre de grandeur (equipe, users, marches) present ? "20+ interviews", "CRM & B2B", "3 equipes", "100M utilisateurs" = scope OK. Il suffit d'un chiffre OU d'un perimetre nomme.
   - impact : consequence visible (qualitative OK) ?
   - completude : matiere suffisante ?

3. EXPLIQUER chaque critere (reasons)
   - Pour chaque critere, donne une explication COURTE (10 mots max)
   - Si true â†’ cite les elements du bullet qui valident (ex: "CRM Accor, structuration produit, vision")
   - Si false â†’ dis ce qui manque + un exemple concret (ex: "Pas d'echelle. Ex: pour combien d'equipes ?")

4. SUGGERER une amelioration (optionnel)
   - Si un critere est false â†’ UNE suggestion courte (15 mots max)
   - Si tout est true â†’ suggestion = null
   - Ne demande JAMAIS un % ou KPI exact

EXPERIENCE : ${exp.title} chez ${exp.company}
BULLET : ${text.trim()}

JSON uniquement :
{
  "tags": ["tag1", "tag2"],
  "evaluation": {"clarte": true, "contexte": true, "scope": false, "impact": true, "completude": true},
  "reasons": {"clarte": "CRM Accor, structuration, vision, DA", "contexte": "CRM chez Accor", "scope": "Pas d'echelle. Ex: combien d'equipes ?", "impact": "Coherence globale", "completude": "Matiere suffisante"},
  "suggestion": "Tu pourrais preciser le nombre d'equipes concernees" ou null
}`;

      const result = await completeJson(openai, {
        model: LLM_MODELS.fast,
        messages: [{ role: "user", content: prompt }],
        schema: TAG_EVAL_SCHEMA,
        temperature: 0.2,
      });

      res.json({
        tags: Array.isArray(result.tags) ? result.tags : ["general"],
        evaluation: result.evaluation || null,
        reasons: result.reasons || null,
        suggestion: result.suggestion || null,
      });
    } catch (err: any) {
      console.error("[TAG-EVAL] Error:", err.message);
      res.json({ tags: ["general"], evaluation: null, suggestion: null, llmError: true });
    }
  });

  // CHECK MATCH — dry run (steps 1-4 only, no CV saved)
  app.post("/api/check-match", async (req, res) => {
    try {
      const { url, text, extraContext } = req.body;
      const resolvedInput = await resolveJobInput({ url, text, extraContext });
      if (!resolvedInput.ok) {
        return res.status(400).json({ message: resolvedInput.errorMessage, scrapeFailed: resolvedInput.metadata.scrapeStatus !== "not_attempted", jobInput: resolvedInput.metadata });
      }
      const userId = uid(req);
      const allExps = await storage.getExperiences(userId);
      const allBullets = await storage.getAllBullets(userId);
      const allSkills = await storage.getSkills(userId);
      if (allExps.length === 0) return res.status(400).json({ message: "Bibliotheque vide." });
      const fastResult = await runFastDryRun({
        jobText: resolvedInput.effectiveJobText,
        allExperiences: allExps, allBullets,
      });
      let result = fastResult;

      if (openai && (fastResult.viability === "weak" || fastResult.viability === "uncertain")) {
        result = await runDryRunCheck({
          jobText: resolvedInput.effectiveJobText,
          mode: "original",
          bodyMaxChars: 3500,
          allExperiences: allExps,
          allBullets,
          allSkills,
          embeddingStore: embeddingStoreFor(userId),
        }, openai);
      }

      if (resolvedInput.metadata.scrapeQuality !== "good" && result.shouldWarn) {
        result = {
          ...result,
          precheckVerdict: "prudence",
          shouldWarn: false,
          warningMessage: "Le pre-check reste incertain car l'annonce recuperee est partiellement bruitee. Tu peux continuer, mais le score est a lire avec prudence.",
        };
      }

      if (resolvedInput.metadata.scrapeQuality !== "good" && result.precheckVerdict === "go") {
        result = {
          ...result,
          precheckVerdict: "prudence",
          warningMessage: result.warningMessage || "Le triage rapide est positif, mais la source de l'annonce reste partiellement bruitee. Lis ce signal avec prudence.",
        };
      }

      res.json({ ...result, jobInput: resolvedInput.metadata });
    } catch (e: any) {
      console.error("[CHECK-MATCH] Error:", e.message);
      res.status(500).json({ message: "Erreur lors du check match." });
    }
  });

  // Tailor — Pipeline V2
  app.post(api.tailor.generate.path, async (req, res) => {
    try {
      const { url, text, mode, outputLength, customMaxChars, introMaxChars, bodyMaxChars, extraContext, angle, language } = api.tailor.generate.input.parse(req.body);
      const resolvedInput = await resolveJobInput({ url, text, extraContext });
      if (!resolvedInput.ok) {
        return res.status(400).json({
          message: resolvedInput.errorMessage,
          scrapeFailed: resolvedInput.metadata.scrapeStatus !== "not_attempted",
          jobInput: resolvedInput.metadata,
        });
      }
      const userId = uid(req);

      // Mode assemblage : déterministe, fonctionne aussi sans clé IA.
      if (mode === "assembly") {
        const [allExps, allBullets, allSkills, profileData, formationRows, langRows, variants] = await Promise.all([
          storage.getExperiences(userId), storage.getAllBullets(userId), storage.getSkills(userId),
          storage.getProfile(userId), storage.getFormations(userId), storage.getLanguages(userId),
          Promise.all([storage.getBulletVariants(userId), storage.getProfileVariants(userId)]),
        ]);
        if (allExps.length === 0) return res.status(400).json({ message: "Ta bibliothèque est vide : ajoute d'abord des expériences." });
        const assembled = await assembleCv({
          jobText: resolvedInput.effectiveJobText,
          experiences: allExps, bullets: allBullets, skills: allSkills,
          bulletVariants: variants[0], profileVariants: variants[1],
          profile: profileData ? { name: profileData.name, title: profileData.title, summary: profileData.summary } : undefined,
          formations: formationRows, languages: langRows,
          bodyMaxChars: bodyMaxChars || customMaxChars, angle, language,
          embeddingStore: embeddingStoreFor(userId),
        }, openai);
        const jobPost = await storage.createJobPost(userId, {
          url: resolvedInput.metadata.normalizedUrl,
          rawText: resolvedInput.effectiveJobText,
          extractedJson: { jobInput: resolvedInput.metadata } as any,
        });
        const run = await storage.createRun(userId, {
          jobPostId: jobPost.id,
          mode,
          selectedExperienceIds: assembled.selectedExperienceIds,
          selectedBulletIds: assembled.selectedBulletIds,
          outputCvText: assembled.cvText,
          outputReportJson: buildAssemblyReport(assembled) as any,
        });
        return res.status(201).json(run);
      }

      if (!openai) {
        return res.status(503).json({ message: "Service IA non configuré : utilise le mode Assemblage ou ajoute une clé." });
      }
      // Load all data
      const allExps = await storage.getExperiences(userId);
      const allBullets = await storage.getAllBullets(userId);
      const allSkills = await storage.getSkills(userId);
      const profileData = await storage.getProfile(userId);
      const formations = await storage.getFormations(userId);
      const langs = await storage.getLanguages(userId);

      if (allExps.length === 0) {
        return res.status(400).json({ message: "Your CV library is empty. Please add experiences first." });
      }

      // Run Pipeline V2
      const result = await runTailorPipeline({
        jobText: resolvedInput.effectiveJobText,
        mode,
        outputLength,
        customMaxChars,
        introMaxChars,
        bodyMaxChars,
        allExperiences: allExps,
        allBullets: allBullets,
        allSkills: allSkills,
        profile: profileData ? { name: profileData.name, title: profileData.title, summary: profileData.summary } : undefined,
        formations,
        languages: langs,
        embeddingStore: embeddingStoreFor(userId),
      }, openai);

      // Save job post
      const jobPost = await storage.createJobPost(userId, {
        url: resolvedInput.metadata.normalizedUrl,
        rawText: resolvedInput.effectiveJobText,
        extractedJson: { jobInput: resolvedInput.metadata } as any,
      });

      // Save run
      const run = await storage.createRun(userId, {
        jobPostId: jobPost.id,
        mode,
        selectedExperienceIds: result.selectedExperienceIds,
        selectedBulletIds: result.selectedBulletIds,
        outputCvText: result.cvText,
        outputReportJson: result.report as any,
      });

      res.status(201).json(run);
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      console.error("[TAILOR] Unexpected error:", e);
      res.status(500).json({ message: "An unexpected error occurred during CV generation." });
    }
  });

  // Enregistre le texte du CV modifié à la main par l'utilisateur.
  app.patch("/api/runs/:id/cv", async (req, res) => {
    const parsed = z.object({ text: z.string().min(1).max(20000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Texte de CV invalide." });
    const run = await storage.updateRunOutput(uid(req), req.params.id, parsed.data.text);
    if (!run) return res.status(404).json({ message: "Not found" });
    res.json(run);
  });

  // Rapproche UN bullet du vocabulaire de l'offre, à la demande. La retouche
  // est validée par code, tracée et annulable comme les autres.
  app.post("/api/runs/:id/align", async (req, res) => {
    const userId = uid(req);
    const parsed = z.object({ experienceIndex: z.number().int().min(0), bulletIndex: z.number().int().min(0) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Bullet invalide." });
    if (!openai) return res.status(503).json({ message: "Service IA non configuré." });
    const run = await storage.getRun(userId, req.params.id);
    if (!run) return res.status(404).json({ message: "Not found" });
    const report = run.outputReportJson as OptimizationReport | null;
    const cv = report?.structuredCV;
    if (!cv || !cv.experiences[parsed.data.experienceIndex]?.bullets[parsed.data.bulletIndex]) {
      return res.status(400).json({ message: "Bullet introuvable dans ce CV." });
    }
    const already = (report.rewrites || []).some(r => r.target === "bullet" && !r.reverted
      && r.experienceIndex === parsed.data.experienceIndex && r.bulletIndex === parsed.data.bulletIndex);
    if (already) return res.status(409).json({ message: "Ce bullet a déjà été retouché." });
    try {
      const job = await parseJobDescription(run.jobPost?.rawText || "", openai);
      job.language = report.cvLanguage || job.language;
      const before = (cv.rewrites || report.rewrites || []).length;
      const next = await composeCVDocument({ ...cv, rewrites: report.rewrites || cv.rewrites || [] }, job, openai, {
        candidates: [{ ...parsed.data, reason: "rapproché du vocabulaire de l'offre à ta demande" }],
        rewriteSummary: false,
      });
      if ((next.rewrites || []).length === before) {
        return res.status(422).json({ message: "Aucune retouche honnête trouvée : la phrase reste la tienne." });
      }
      const text = renderCV(next, report.cvLanguage || "FR");
      const updated = await storage.updateRunOutput(userId, run.id, text, { ...report, structuredCV: next, rewrites: next.rewrites });
      res.json(updated);
    } catch (err: any) {
      console.error("[ALIGN] Error:", err.message);
      res.status(502).json({ message: "Retouche indisponible pour le moment." });
    }
  });

  // Annule une retouche IA : la formulation d'origine de l'utilisateur revient.
  app.post("/api/runs/:id/rewrites/:index/revert", async (req, res) => {
    const userId = uid(req);
    const run = await storage.getRun(userId, req.params.id);
    if (!run) return res.status(404).json({ message: "Not found" });
    const report = run.outputReportJson as OptimizationReport | null;
    const index = Number(req.params.index);
    if (!report?.structuredCV || !Number.isInteger(index) || !report.rewrites?.[index]) {
      return res.status(400).json({ message: "Retouche introuvable pour ce CV." });
    }
    const cv = revertRewrite({ ...report.structuredCV, rewrites: report.rewrites }, index);
    const text = renderCV(cv, report.cvLanguage || "FR");
    const updated = await storage.updateRunOutput(userId, run.id, text, { ...report, structuredCV: cv, rewrites: cv.rewrites });
    res.json(updated);
  });

  app.get(api.tailor.getRun.path, async (req, res) => {
    const run = await storage.getRun(uid(req), req.params.id);
    if (!run) return res.status(404).json({ message: "Not found" });
    res.json(run);
  });

  return httpServer;
}

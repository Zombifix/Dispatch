import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import passport from "passport";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import OpenAI from "openai";
import { db } from "./db";
import { bullets, runs } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  normalizeLinkedInUrl,
  checkLLMHealth,
  runTailorPipeline,
  runDryRunCheck,
  runFastDryRun,
} from "./tailoring-engine";
import { createUser, getUserByEmail } from "./auth";
import { resolveCompanyLogo } from "./company-logo";
import type { User } from "@shared/schema";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "Unauthorized" });
}

let openai: OpenAI | null = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

// Embeddings disabled as per request
async function getEmbedding(text: string): Promise<number[]> {
  return Array(1536).fill(0);
}

function uid(req: Request): number {
  return (req.user as User).id;
}

const BLOCKED_DOMAINS = [
  "indeed.com", "glassdoor.com", "monster.com",
  "apec.fr", "francetravail.fr", "pole-emploi.fr", "hellowork.com", "cadremploi.fr",
];

// ── Phase 1: In-memory scrape cache (TTL 5 min) ──
const SCRAPE_CACHE_TTL_MS = 5 * 60 * 1000;
const scrapeCache = new Map<string, { text: string; metadata: JobInputMetadata; timestamp: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of scrapeCache) {
    if (now - entry.timestamp > SCRAPE_CACHE_TTL_MS) scrapeCache.delete(key);
  }
}, 10 * 60 * 1000);

// ── Phase 4: Soft-block adaptatif ──
const SOFT_BLOCK_THRESHOLD = 3;
const SOFT_BLOCK_WINDOW_MS = 24 * 60 * 60 * 1000;
const softBlockMap = new Map<string, { failCount: number; lastFailure: number }>();

function isSoftBlocked(hostname: string): boolean {
  const entry = softBlockMap.get(hostname);
  if (!entry) return false;
  if (Date.now() - entry.lastFailure > SOFT_BLOCK_WINDOW_MS) {
    softBlockMap.delete(hostname);
    return false;
  }
  return entry.failCount >= SOFT_BLOCK_THRESHOLD;
}

function recordSoftBlock(hostname: string): void {
  const entry = softBlockMap.get(hostname);
  const now = Date.now();
  if (entry && now - entry.lastFailure <= SOFT_BLOCK_WINDOW_MS) {
    entry.failCount++;
    entry.lastFailure = now;
  } else {
    softBlockMap.set(hostname, { failCount: 1, lastFailure: now });
  }
  const updated = softBlockMap.get(hostname)!;
  if (updated.failCount >= SOFT_BLOCK_THRESHOLD) {
    console.log(`[SCRAPE] Soft-blocked domain: ${hostname} (${updated.failCount} failures in 24h)`);
  }
}

type JobInputMetadata = {
  sourceType: "url" | "text";
  normalizedUrl?: string;
  scrapeStatus: "success" | "blocked" | "failed" | "not_attempted";
  scrapeQuality: "good" | "uncertain" | "bad";
  scrapeMessage: string;
};

type ResolvedJobInput = {
  ok: boolean;
  effectiveJobText: string;
  metadata: JobInputMetadata;
  errorMessage?: string;
};

function getScrapeFailureMessage(url?: string, blocked?: boolean): string {
  const isLinkedIn = !!url && url.includes("linkedin.com");
  if (blocked) {
    return isLinkedIn
      ? "Je n'ai pas pu lire l'annonce LinkedIn. LinkedIn a bloque la recuperation automatique. Colle le texte de l'annonce pour continuer."
      : "Le site a bloque la recuperation automatique. Colle le texte de l'annonce pour continuer.";
  }
  return isLinkedIn
    ? "Je n'ai pas pu lire l'annonce LinkedIn. Colle le texte de l'annonce pour continuer."
    : "Impossible de recuperer le contenu de cette URL. Colle le texte de l'annonce pour continuer.";
}

// ── Phase 2: Fetch with retry ──
async function fetchWithRetry(
  url: string,
  opts: RequestInit & { signal?: AbortSignal },
  { maxRetries = 1, baseDelay = 1500 } = {},
): Promise<globalThis.Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const timeout = attempt === 0 ? 15_000 : 20_000;
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeout) });
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      // 5xx → retry
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, baseDelay * (attempt + 1)));
    }
  }
  throw lastError;
}

// ── Phase 7: Direct fetch fallback + JSON-LD extraction ──
function extractJsonLdJobPosting(html: string): string | null {
  const scriptRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const candidates = Array.isArray(data) ? data : [data];
      for (const item of candidates) {
        const obj = item?.["@graph"] ? (item["@graph"] as any[]).find((g: any) => g["@type"] === "JobPosting") : item;
        if (!obj || obj["@type"] !== "JobPosting") continue;
        const parts: string[] = [];
        if (obj.title) parts.push(`# ${obj.title}`);
        if (obj.hiringOrganization?.name) parts.push(`Company: ${obj.hiringOrganization.name}`);
        if (obj.description) parts.push(stripHtmlTags(obj.description));
        if (obj.responsibilities) parts.push(`\nResponsibilities:\n${stripHtmlTags(obj.responsibilities)}`);
        if (obj.qualifications) parts.push(`\nQualifications:\n${stripHtmlTags(obj.qualifications)}`);
        if (obj.experienceRequirements) parts.push(`\nExperience:\n${typeof obj.experienceRequirements === "string" ? obj.experienceRequirements : JSON.stringify(obj.experienceRequirements)}`);
        if (obj.skills) parts.push(`\nSkills:\n${typeof obj.skills === "string" ? obj.skills : JSON.stringify(obj.skills)}`);
        if (parts.length >= 2) return parts.join("\n\n");
      }
    } catch { /* invalid JSON-LD, skip */ }
  }
  return null;
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#\d+;/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function directFetchFallback(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; CVTailor/1.0)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Try JSON-LD first (structured, clean)
    const jsonLdText = extractJsonLdJobPosting(html);
    if (jsonLdText && jsonLdText.length >= 200) return jsonLdText;

    // Fallback: strip HTML tags
    const plainText = stripHtmlTags(html);
    return plainText.length >= 200 ? plainText : null;
  } catch {
    return null;
  }
}

function suspiciousEncodingCount(text: string): number {
  return (text.match(/Ã|Â|â€™|â€œ|â€|â€“|â€”|�/g) || []).length;
}

function repairScrapeEncoding(text: string): string {
  let repaired = String(text ?? "");
  const beforeScore = suspiciousEncodingCount(repaired);

  if (beforeScore > 0) {
    try {
      const decoded = Buffer.from(repaired, "latin1").toString("utf8");
      if (decoded && suspiciousEncodingCount(decoded) < beforeScore) {
        repaired = decoded;
      }
    } catch {}
  }

  return repaired.normalize("NFKC");
}

type JobTextQualityAssessment = {
  ok: boolean;
  quality: "good" | "uncertain" | "bad";
  warning?: string;
  note?: string;
};

function assessJobTextQuality(text: string): JobTextQualityAssessment {
  const lower = text.toLowerCase();
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  const JOB_SIGNALS = [
    "mission", "responsabilit", "profil", "requis", "experience", "competence",
    "description du poste", "vous serez", "vous aurez", "votre role", "about the role",
    "responsibilities", "requirements", "qualifications", "you will", "we are looking",
    "poste", "missions", "activites", "objectifs", "perimetre",
  ];
  const PERK_SIGNALS = [
    "alan", "swile", "titre-restaurant", "ticket restaurant", "ticket-restaurant",
    "full remote", "teletravail", "mutuelle", "stock option", "rtt ",
    "seminaire", "onboarding", "avantage", "benefits", "package salarial",
    "bien-etre", "flexi", "conges", "prime",
  ];
  const FORM_SIGNALS = [
    "postuler", "candidater", "soumettre ma candidature", "submit application",
    "votre cv", "upload cv", "upload your cv", "telecharger votre cv",
    "formulaire de candidature", "application form", "apply now",
    "deja postule", "already applied", "je postule",
    "etape 1", "step 1 of", "step 1:",
    "prenom *", "nom *", "email *", "telephone *",
    "type de contrat souhait", "lettre de motivation", "disponibilit",
    "pieces jointes", "attach", "browse files",
  ];
  const jobScore = JOB_SIGNALS.filter(s => lower.includes(s)).length;
  const perkScore = PERK_SIGNALS.filter(s => lower.includes(s)).length;
  const formScore = FORM_SIGNALS.filter(s => lower.includes(s)).length;
  const uniqueLineRatio = lines.length > 0
    ? new Set(lines.map(line => line.toLowerCase())).size / lines.length
    : 1;
  const noiseScore = [
    "cookie",
    "cookies",
    "axeptio",
    "gestion des cookies",
    "se connecter",
    "postuler",
    "sauvegarder",
    "partager",
    "non merci",
  ].filter(signal => lower.includes(signal)).length;
  const repeatedContent = lines.length >= 8 && uniqueLineRatio < 0.75;

  if (formScore >= 3) {
    return {
      ok: false,
      quality: "bad",
      warning: "Le lien pointe vers un formulaire de candidature, pas vers l'annonce. Reviens sur la page de l'offre et copie le texte de la description du poste.",
    };
  }
  if (formScore >= 2 && jobScore <= 2) {
    return {
      ok: false,
      quality: "bad",
      warning: "Le contenu recupere ressemble a un formulaire de candidature plutot qu'a une description de poste. Colle directement le texte de l'annonce.",
    };
  }
  if (jobScore === 0 && perkScore >= 3) {
    return {
      ok: false,
      quality: "bad",
      warning: "Le contenu recupere semble incomplet (avantages uniquement, sans description du poste). Colle le texte complet de l'annonce pour continuer.",
    };
  }
  if (jobScore <= 1 && perkScore > 0 && perkScore >= Math.max(2, jobScore * 2)) {
    return {
      ok: false,
      quality: "bad",
      warning: "L'annonce recuperee semble partielle. Colle le texte integral de l'annonce pour un scoring fiable.",
    };
  }
  if (text.length < 260 || (jobScore === 0 && lines.length < 8)) {
    return {
      ok: false,
      quality: "bad",
      warning: "Le contenu recupere est trop court ou incomplet pour une analyse fiable. Colle le texte complet de l'annonce.",
    };
  }

  const likelyUsable = text.length > 600 && jobScore >= 2 && noiseScore <= 2 && !repeatedContent;
  if (likelyUsable) {
    return { ok: true, quality: "good" };
  }
  if (jobScore >= 2) {
    return {
      ok: true,
      quality: "uncertain",
      note: "Annonce partiellement bruitee ou incomplete: le scoring reste possible, mais la lecture peut etre moins fiable.",
    };
  }

  return {
    ok: true,
    quality: "uncertain",
    note: "Annonce lisible mais peu structuree: le scoring repose sur des signaux partiels.",
  };
}

function isBlockedScrapeText(text: string): boolean {
  const lowerText = text.toLowerCase();
  return lowerText.includes("cloudflare") ||
    lowerText.includes("just a moment") ||
    lowerText.includes("checking your browser") ||
    lowerText.includes("enable javascript") ||
    lowerText.includes("access denied") ||
    lowerText.includes("403 forbidden") ||
    (lowerText.includes("indeed") && lowerText.includes("robot") && text.length < 2000);
}

const JOB_TEXT_NOISE_PATTERNS = [
  /^blah blah blah cookie/i,
  /gestion des cookies/i,
  /declaration de cookies/i,
  /politique de confidentialite/i,
  /cookies? de fonctionnalites?/i,
  /annonces personnalisees/i,
  /mesures d'audience/i,
  /axeptio/i,
  /^non merci$/i,
  /^je choisis$/i,
  /^ok pour moi$/i,
  /^trouver un job$/i,
  /^trouver une entreprise$/i,
  /^media$/i,
  /^employeurs$/i,
  /^candidatures$/i,
  /^opportunites$/i,
  /^se connecter$/i,
  /^retour$/i,
  /^postuler$/i,
  /^sauvegarder$/i,
  /^partager$/i,
  /^voir plus$/i,
  /^envie d'en savoir plus \?$/i,
  /^questions et reponses sur l'offre$/i,
  // Phase 6: EN navigation noise
  /^sign in$/i,
  /^log in$/i,
  /^apply$/i,
  /^save$/i,
  /^share$/i,
  /^report this job$/i,
  /^show more$/i,
  /^show less$/i,
  // Phase 6: EN cookie/privacy
  /^cookie settings$/i,
  /^privacy policy$/i,
  /^cookie policy$/i,
  /^manage preferences$/i,
  // Phase 6: generic nav
  /^home$/i,
  /^jobs$/i,
  /^companies$/i,
  /^resources$/i,
  /^about us$/i,
];

function sanitizeJobText(rawText: string): string {
  const normalized = repairScrapeEncoding(rawText).replace(/\r/g, "").trim();
  if (!normalized) return normalized;

  let lines = normalized
    .split("\n")
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const startMarkers = [
    "descriptif du poste",
    "description du poste",
    "le poste",
    "job description",
    "about the job",
    "the position",
    // Phase 6: additional FR markers
    "a propos du poste",
    "votre mission",
    "vos missions",
    "contexte du poste",
    "presentation du poste",
    // Phase 6: additional EN markers
    "about the role",
    "the role",
    "what you'll do",
    "your mission",
    "role overview",
    "position overview",
  ];

  const startIndex = lines.findIndex(line =>
    startMarkers.some(marker => line.toLowerCase().includes(marker)),
  );
  if (startIndex > 0) {
    lines = lines.slice(startIndex);
  }

  const filtered = lines.filter(line => !JOB_TEXT_NOISE_PATTERNS.some(pattern => pattern.test(line)));
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const line of filtered) {
    const signature = line.toLowerCase();
    if (signature.length >= 8 && seen.has(signature)) continue;
    if (signature.length >= 8) seen.add(signature);
    deduped.push(line);
  }
  return deduped.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
}

async function resolveJobInput(params: { url?: string; text?: string; extraContext?: string }): Promise<ResolvedJobInput> {
  const normalizedUrl = params.url ? normalizeLinkedInUrl(params.url) : undefined;
  let effectiveJobText = sanitizeJobText((params.text || "").trim());
  const metadata: JobInputMetadata = {
    sourceType: effectiveJobText ? "text" : "url",
    normalizedUrl,
    scrapeStatus: effectiveJobText ? "not_attempted" : "failed",
    scrapeQuality: effectiveJobText ? "good" : "bad",
    scrapeMessage: effectiveJobText
      ? "Description collee manuellement."
      : normalizedUrl
        ? "Recuperation de l'annonce en attente."
        : "Aucune annonce fournie.",
  };

  if (!effectiveJobText && !normalizedUrl) {
    return { ok: false, effectiveJobText: "", metadata, errorMessage: "Please provide a job description or URL." };
  }

  if (!effectiveJobText && normalizedUrl) {
    // Phase 1: Check cache first
    const cached = scrapeCache.get(normalizedUrl);
    if (cached && Date.now() - cached.timestamp < SCRAPE_CACHE_TTL_MS) {
      console.log(`[SCRAPE] Cache hit for ${normalizedUrl}`);
      effectiveJobText = cached.text;
      Object.assign(metadata, cached.metadata);
    } else {
      let hostname = "";
      try {
        hostname = new URL(normalizedUrl).hostname.toLowerCase();
        // Hard-block check
        if (BLOCKED_DOMAINS.some(d => hostname.includes(d))) {
          metadata.scrapeStatus = "blocked";
          metadata.scrapeMessage = getScrapeFailureMessage(normalizedUrl, true);
          return { ok: false, effectiveJobText: "", metadata, errorMessage: metadata.scrapeMessage };
        }
        // Phase 4: Soft-block check
        if (isSoftBlocked(hostname)) {
          console.log(`[SCRAPE] Soft-blocked: ${hostname}`);
          metadata.scrapeStatus = "blocked";
          metadata.scrapeMessage = getScrapeFailureMessage(normalizedUrl, true);
          return { ok: false, effectiveJobText: "", metadata, errorMessage: metadata.scrapeMessage };
        }
      } catch {}

      // Phase 2: Jina fetch with retry
      let jinaFailed = false;
      try {
        const jinaRes = await fetchWithRetry(
          `https://r.jina.ai/${normalizedUrl}`,
          { headers: { "Accept": "text/plain", "X-Return-Format": "text" } },
          { maxRetries: 1, baseDelay: 1500 },
        );
        if (jinaRes.ok) {
          effectiveJobText = sanitizeJobText(await jinaRes.text());
          metadata.scrapeStatus = "success";
          metadata.scrapeMessage = normalizedUrl.includes("linkedin.com")
            ? "Annonce recuperee automatiquement depuis LinkedIn."
            : "Annonce recuperee automatiquement depuis l'URL.";
        } else {
          jinaFailed = true;
        }
      } catch {
        jinaFailed = true;
      }

      // Phase 7: Direct fetch fallback if Jina failed
      if (jinaFailed && (!effectiveJobText || effectiveJobText.length < 150)) {
        console.log(`[SCRAPE] Jina failed for ${normalizedUrl}, trying direct fetch fallback`);
        const fallbackText = await directFetchFallback(normalizedUrl);
        if (fallbackText) {
          effectiveJobText = sanitizeJobText(fallbackText);
          metadata.scrapeStatus = "success";
          metadata.scrapeMessage = "Annonce recuperee via fallback direct.";
          console.log(`[SCRAPE] Direct fetch fallback succeeded (${effectiveJobText.length} chars)`);
        } else {
          metadata.scrapeStatus = "failed";
          metadata.scrapeMessage = getScrapeFailureMessage(normalizedUrl, false);
        }
      }

      // Phase 1: Cache successful scrapes
      if (effectiveJobText && effectiveJobText.length >= 150) {
        scrapeCache.set(normalizedUrl, { text: effectiveJobText, metadata: { ...metadata }, timestamp: Date.now() });
      }
    }
  }

  if (!effectiveJobText || effectiveJobText.length < 150) {
    if (!params.text?.trim()) {
      metadata.scrapeStatus = metadata.scrapeStatus === "success" ? "failed" : metadata.scrapeStatus;
      metadata.scrapeMessage = getScrapeFailureMessage(normalizedUrl, metadata.scrapeStatus === "blocked");
    }
    return { ok: false, effectiveJobText: "", metadata, errorMessage: metadata.scrapeMessage };
  }

  if (isBlockedScrapeText(effectiveJobText)) {
    // Phase 4: Record soft-block
    if (normalizedUrl) {
      try { recordSoftBlock(new URL(normalizedUrl).hostname.toLowerCase()); } catch {}
    }
    metadata.scrapeStatus = "blocked";
    metadata.scrapeMessage = getScrapeFailureMessage(normalizedUrl, true);
    return { ok: false, effectiveJobText: "", metadata, errorMessage: metadata.scrapeMessage };
  }

  // Quality gate: detect perks-only or partial scrapes
  const qualityCheck = assessJobTextQuality(effectiveJobText);
  metadata.scrapeQuality = qualityCheck.quality;
  if (!qualityCheck.ok) {
    metadata.scrapeStatus = "failed";
    metadata.scrapeMessage = qualityCheck.warning!;
    return { ok: false, effectiveJobText: "", metadata, errorMessage: qualityCheck.warning! };
  }
  if (qualityCheck.quality === "uncertain" && qualityCheck.note) {
    metadata.scrapeMessage = qualityCheck.note;
  }

  if (params.extraContext?.trim()) {
    effectiveJobText += `\n\n---\nAdditional context provided by the candidate:\n${params.extraContext.trim()}`;
  }

  if (metadata.sourceType === "url" && metadata.scrapeStatus !== "success") {
    metadata.scrapeStatus = "success";
    metadata.scrapeMessage = metadata.scrapeQuality === "uncertain"
      ? metadata.scrapeMessage
      : "Annonce recuperee et prete a etre tailoree.";
  }

  return { ok: true, effectiveJobText, metadata };
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

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // CV IMPORT â€” PDF (base64) or text paste â†’ parse ALL experiences
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
        return res.status(500).json({ message: "Service IA non configurÃ© (OPENAI_API_KEY manquant)." });
      }

      const prompt = `Analyse ce CV et extrais TOUTES les expÃ©riences professionnelles.

Pour chaque expÃ©rience, extrais :
- title : intitulÃ© du poste
- company : nom de l'entreprise
- startDate : date de dÃ©but au format YYYY-MM-DD (estime si besoin, ex: "2020" â†’ "2020-01-01")
- endDate : date de fin au format YYYY-MM-DD (null si poste actuel)
- description : rÃ©sumÃ© court du rÃ´le en 1-2 phrases
- bullets : liste des rÃ©alisations/responsabilitÃ©s (chaque bullet = une ligne du CV)

RÃ©ponds UNIQUEMENT en JSON valide, sans markdown ni backticks :
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

CV Ã  analyser :
${truncated}`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      let parsed;
      try {
        parsed = JSON.parse(response.choices[0].message.content || "{}");
      } catch {
        return res.status(500).json({ message: "L'IA n'a pas pu analyser le contenu." });
      }

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

  // Parse experience from raw text
  app.post("/api/experiences/parse", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ message: "text required" });
      
      if (!openai) {
        return res.json({
          title: text.split("\n")[0].slice(0, 50),
          company: "Unknown",
          summary: text.slice(0, 200),
        });
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: `Parse this raw experience text into structured JSON. Be strict about what is explicitly mentioned. If a field is not mentioned, omit it. Return ONLY valid JSON with these fields: title, company, employmentType, startDate (YYYY-MM-DD format), endDate (YYYY-MM-DD format), location, summary (brief 1-2 sentences), responsibilities (array of 3-5 bullet points), achievements (array of 3-5 bullet points with metrics), skills (array of technical skills), tools (array of software/tools), industry (array of industry tags).

Raw experience text:
${text}`,
        }],
        response_format: { type: "json_object" },
      });

      const parsed = JSON.parse(response.choices[0].message.content || "{}");
      res.json(parsed);
    } catch (err: any) {
      console.error("Parse error", err);
      res.status(500).json({ message: "Failed to parse experience" });
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
      getEmbedding(bullet.text).then(emb => storage.updateBulletEmbedding(bullet.id, emb));
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
      if (input.text) {
        getEmbedding(input.text).then(emb => storage.updateBulletEmbedding(bullet.id, emb));
      }
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
  app.post(api.bullets.reEmbedAll.path, async (req, res) => {
    const all = await storage.getAllBullets(uid(req));
    let count = 0;
    for (const b of all) {
      const emb = await getEmbedding(b.text);
      await storage.updateBulletEmbedding(b.id, emb);
      count++;
    }
    res.json({ success: true, count });
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

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      let result;
      try {
        result = JSON.parse(response.choices[0].message.content || "{}");
      } catch {
        return res.json({ skills: [] });
      }

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

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // PROFILE
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

  // Role target check â€” analyze library against a target role
  app.post("/api/profile/check-role", async (req, res) => {
    try {
      const { role } = req.body;
      if (!role) return res.status(400).json({ message: "role required" });
      const userId = uid(req);
      const allExps = await storage.getExperiences(userId);
      const allBullets = await storage.getAllBullets(userId);

      if (allExps.length === 0) return res.json({ summary: "Ajoutez des experiences d'abord.", dimensions: [] });

      if (!openai) return res.json({ summary: "Service IA non configure.", dimensions: [] });

      const expSummaries = allExps.map(exp => {
        const expBullets = allBullets.filter(b => b.experienceId === exp.id);
        return `${exp.title} chez ${exp.company}:\n${expBullets.map(b => `- ${b.text} [tags: ${(b.tags || []).join(", ")}]`).join("\n")}`;
      }).join("\n\n");

      const prompt = `Analyse ce profil par rapport au poste vise : "${role}".

EXPERIENCES :
${expSummaries.slice(0, 5000)}

Evalue 5-6 dimensions cles pour ce type de poste. Pour chaque dimension :
- score de 0 a 100
- status : "fort" (70+), "correct" (40-69), "leger" (15-39), "absent" (0-14)
- bullets : combien de bullets couvrent cette dimension
- Si le score est faible, propose un "tip" : soit un pont avec une experience existante, soit un constat de manque

Termine par un "summary" : 2 phrases max, ton direct, qui resume les forces et les trous.

Reponds UNIQUEMENT en JSON :
{
  "summary": "...",
  "dimensions": [
    {"name": "...", "score": 80, "status": "fort", "bullets": 3, "tip": null},
    {"name": "...", "score": 20, "status": "leger", "bullets": 1, "tip": "Ton experience X peut se reformuler sous cet angle."}
  ]
}`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.4,
      });

      let result;
      try { result = JSON.parse(response.choices[0].message.content || "{}"); }
      catch { result = { summary: "Impossible d'analyser.", dimensions: [] }; }

      res.json(result);
    } catch (err: any) {
      console.error("[CHECK-ROLE] Error:", err.message);
      res.json({ summary: "Erreur lors de l'analyse.", dimensions: [] });
    }
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // FORMATIONS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // LANGUAGES
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // SETTINGS â€” reset all data
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // ── SETTINGS — export user data ──
  app.get("/api/settings/export", requireAuth, async (req, res) => {
    try {
      const userId = uid(req);
      const [userProfile, userExperiences, userSkills, userFormations, userLanguages, userRuns] = await Promise.all([
        storage.getProfile(userId),
        storage.getExperiences(userId),
        storage.getSkills(userId),
        storage.getFormations(userId),
        storage.getLanguages(userId),
        storage.getRuns(userId),
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

  // ── COMPANY LOGO — one-shot backfill for runs created before logo lookup existed ──
  app.post("/api/runs/:id/company-logo", async (req, res) => {
    try {
      const userId = uid(req);
      const run = await storage.getRun(userId, req.params.id);
      if (!run) return res.status(404).json({ message: "Not found" });
      const extracted = (run.jobPost?.extractedJson ?? {}) as Record<string, unknown>;
      if ("companyLogoUrl" in extracted) return res.json({ companyLogoUrl: extracted.companyLogoUrl ?? null });
      const companyLogoUrl = await resolveCompanyLogo(run.jobPost?.url);
      await storage.mergeJobPostExtracted(userId, run.jobPostId, { companyLogoUrl });
      res.json({ companyLogoUrl });
    } catch (err: any) {
      console.error("[LOGO] Error:", err.message);
      res.status(500).json({ error: "Erreur serveur." });
    }
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

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // EXTRACT AXES â€” parse description + bullets into mission axes
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      let result;
      try {
        result = JSON.parse(response.choices[0].message.content || "{}");
      } catch { result = { axes: [] }; }

      res.json({ axes: (result.axes || []).slice(0, 5) });
    } catch (err: any) {
      console.error("[AXES] Error:", err.message);
      res.json({ axes: [], llmError: true });
    }
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // GAP DETECTION â€” analyze experience + bullets, find what's missing
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

ETAPE 1 â€” IDENTIFIER LES MISSIONS/PERIMETRES DISTINCTS
Regarde la description et les bullets. S'il y a plusieurs MISSIONS ou PERIMETRES de travail differents (ex: CRM + B2B, app mobile + back-office, produit client + produit interne), identifie-les.
ATTENTION : une competence transversale (design system, user research, figma) n'est PAS un perimetre distinct. Un perimetre = un projet, un produit, ou un scope de responsabilite separe.

EXPERIENCE :
- Poste : ${exp.title}
- Entreprise : ${exp.company}
- Description : ${exp.description || "Aucune"}
${existingBullets.length > 0 ? `\nBULLETS EXISTANTS :\n${bulletTexts}` : "\nAucun bullet existant."}

ETAPE 2 â€” TROUVER LES LACUNES
Pour CHAQUE mission/perimetre, verifie ces dimensions. PRIORISE les dimensions qui donnent des CHIFFRES :
1. SCOPE â€” combien ? (utilisateurs, marques, boutiques, equipe, budget)
2. IMPACT â€” quel resultat mesurable ? (%, temps gagne, avant/apres, adoption)
3. CONTEXTE â€” pourquoi ? quel probleme concret a resoudre ?
4. METHODE â€” comment ? quelle approche specifique ?
5. COLLABORATION â€” avec qui ? combien de personnes ?
6. DIFFICULTES â€” quelles contraintes concretes ?

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

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.5,
      });

      let result;
      try {
        result = JSON.parse(response.choices[0].message.content || "{}");
      } catch {
        result = { gaps: [] };
      }

      res.json(result);
    } catch (err: any) {
      console.error("[GAPS] Error:", err.message);
      res.json({ gaps: [], llmError: true });
    }
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // TAG + EVALUATE â€” user writes bullet, LLM tags + evaluates
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.2,
      });

      let result;
      try { result = JSON.parse(response.choices[0].message.content || "{}"); }
      catch { result = { tags: ["general"], evaluation: null, reasons: null, suggestion: null }; }

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

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // CHECK MATCH â€” dry run (steps 1-4 only, no CV saved)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

  // Tailor â€” Pipeline V2
  app.post(api.tailor.generate.path, async (req, res) => {
    try {
      const { url, text, mode, outputLength, customMaxChars, introMaxChars, bodyMaxChars, extraContext } = api.tailor.generate.input.parse(req.body);
      const resolvedInput = await resolveJobInput({ url, text, extraContext });
      if (!resolvedInput.ok) {
        return res.status(400).json({
          message: resolvedInput.errorMessage,
          scrapeFailed: resolvedInput.metadata.scrapeStatus !== "not_attempted",
          jobInput: resolvedInput.metadata,
        });
      }
      if (!openai) {
        return res.status(500).json({ message: "AI service not configured. Please set OPENAI_API_KEY." });
      }
      // Load all data
      const userId = uid(req);
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
      // Company logo lookup runs in parallel with the pipeline (deterministic, never throws).
      const companyLogoPromise = resolveCompanyLogo(resolvedInput.metadata.normalizedUrl);

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
      }, openai);

      // Save job post
      const jobPost = await storage.createJobPost(userId, {
        url: resolvedInput.metadata.normalizedUrl,
        rawText: resolvedInput.effectiveJobText,
        extractedJson: { jobInput: resolvedInput.metadata, companyLogoUrl: await companyLogoPromise } as any,
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

  app.get(api.tailor.getRun.path, async (req, res) => {
    const run = await storage.getRun(uid(req), req.params.id);
    if (!run) return res.status(404).json({ message: "Not found" });
    res.json(run);
  });

  return httpServer;
}

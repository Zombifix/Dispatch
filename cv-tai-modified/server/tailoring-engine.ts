import type OpenAI from "openai";
import { z } from "zod";
import type { Experience, Bullet, Skill } from "@shared/schema";
import { LLM_MODELS, completeJson, TtlCache, contentHash } from "./llm";
import {
  detectLanguage,
  extractAliasConceptsFromText,
  findKeywordAliasGroup,
  isNoisyCriticalKeyword,
  isSpecificToolKeyword,
  keywordDisplayLabel,
  mojibakePenaltyScore,
  normalizeEvidenceText,
  sanitizeOptionalTextValue,
  sanitizeTextList,
  sanitizeTextValue,
  textHasKeyword,
  uniqueItems,
} from "./engine/text";
export { detectLanguage, repairMojibake } from "./engine/text";

// Parsing / scoring : modèle rapide. Résumé, retouches, évaluation : modèle de rédaction.
export const MODEL = LLM_MODELS.fast;
export const WRITER_MODEL = LLM_MODELS.writer;
export const EVAL_MODEL = LLM_MODELS.eval;
export const EMBEDDING_MODEL = LLM_MODELS.embedding;
const WRITER_TEMPERATURE = 0.2;

function log(step: string, data?: any) {
  const summary = data ? (typeof data === "string" ? data.slice(0, 500) : JSON.stringify(data).slice(0, 500)) : "";
  console.log(`[TAILOR] ${step}${summary ? ": " + summary : ""}`);
}

export function normalizeLinkedInUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  try {
    const url = new URL(rawUrl);
    if (!url.hostname.includes("linkedin.com")) return rawUrl;

    // Extract job ID from currentJobId query param (collections, search pages)
    const currentJobId = url.searchParams.get("currentJobId");
    if (currentJobId && /^\d+$/.test(currentJobId)) {
      return `https://www.linkedin.com/jobs/view/${currentJobId}`;
    }

    // Extract job ID from path: /jobs/view/some-title-1234567890/ or /jobs/view/1234567890/
    const pathMatch = url.pathname.match(/\/jobs\/view\/(?:.*?[-/])?(\d{5,})(?:\/|$)/);
    if (pathMatch) {
      return `https://www.linkedin.com/jobs/view/${pathMatch[1]}`;
    }

    // Strip tracking params but keep the rest
    const trackingParams = ["refId", "trackingId", "trk", "midToken", "midSig", "trkEmail", "connectionOf", "lipi"];
    for (const param of trackingParams) url.searchParams.delete(param);
    // Normalize subdomain to www
    url.hostname = "www.linkedin.com";
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export interface LLMHealthResult { provider: string; model: string; baseUrl: string; apiKeyPresent: boolean; success: boolean; rawText: string; responseTimeMs: number; error?: string; }
export async function checkLLMHealth(openai: OpenAI | null): Promise<LLMHealthResult> {
  const r: LLMHealthResult = { provider: process.env.LLM_BASE_URL ? "OpenAI-compatible" : "OpenAI", model: MODEL, baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1", apiKeyPresent: !!(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY), success: false, rawText: "", responseTimeMs: 0 };
  if (!openai) { r.error = "OPENAI_API_KEY not set"; return r; }
  const start = Date.now();
  try { const res = await openai.chat.completions.create({ model: MODEL, messages: [{ role: "user", content: "Reply OK" }], max_tokens: 10 }); r.rawText = res.choices[0]?.message?.content || ""; r.success = true; } catch (e: any) { r.error = e.message; }
  r.responseTimeMs = Date.now() - start; return r;
}

// ── Shared helpers ──
function normalizeSkillKey(s: string): string {
  return s.toLowerCase().replace(/[/\-]/g, " ").replace(/\s+/g, " ").replace(/s$/, "").trim();
}

function cloneStructuredCV(cv: StructuredCV): StructuredCV {
  return {
    ...cv,
    rewrites: (cv.rewrites || []).map(r => ({ ...r })),
    experiences: cv.experiences.map(exp => ({ ...exp, bullets: [...exp.bullets] })),
    skills: [...cv.skills],
    formations: cv.formations.map(f => ({ ...f })),
    languages: cv.languages.map(l => ({ ...l })),
  };
}

function buildStableCriticalKeywords(job: ParsedJob): string[] {
  const candidates = new Map<string, { label: string; score: number; sources: Set<string> }>();

  const addCandidate = (raw: string, weight: number, source: string) => {
    const trimmed = raw?.trim();
    if (!trimmed || isNoisyCriticalKeyword(trimmed)) return;
    const key = findKeywordAliasGroup(trimmed)?.key || normalizeEvidenceText(trimmed);
    if (!key) return;
    const label = keywordDisplayLabel(trimmed, job.language);
    const existing = candidates.get(key);
    if (existing) {
      existing.score += weight;
      existing.sources.add(source);
      if (existing.label.length > label.length) existing.label = label;
      return;
    }
    candidates.set(key, { label, score: weight, sources: new Set([source]) });
  };

  const roleFrameCandidates = [
    ...job.roleFrame.workObjects,
    ...job.roleFrame.deliverables,
    ...job.roleFrame.decisions,
  ];

  for (const item of job.requiredSkills) addCandidate(item, 4, "requiredSkills");
  for (const item of roleFrameCandidates) addCandidate(item, 3, "roleFrame");
  for (const item of extractAliasConceptsFromText(job.responsibilities, job.language)) addCandidate(item, 2.5, "responsibilities");
  for (const item of job.preferredSkills) addCandidate(item, 1.5, "preferredSkills");
  for (const item of job.criticalKeywords) addCandidate(item, 1.25, "criticalKeywords");

  const ranked = [...candidates.values()]
    .sort((a, b) => (b.score - a.score) || (b.sources.size - a.sources.size) || a.label.localeCompare(b.label))
    .map(entry => entry.label);

  return uniqueItems(ranked).slice(0, 8);
}


export interface RoleFrame {
  workObjects: string[];
  deliverables: string[];
  decisions: string[];
  collaborators: string[];
  environments: string[];
  scopeSignals: string[];
}


export type DistanceDomain = "same" | "adjacent" | "different";

// ── Types ──
export interface ParsedJob {
  title: string; company: string; seniority: string; domain: string;
  requiredSkills: string[]; preferredSkills: string[]; responsibilities: string[];
  keywords: string[]; criticalKeywords: string[]; language: "EN" | "FR";
  intentions: string[];
  positioning: "consultant" | "lead" | "ic" | "manager";
  roleFrame: RoleFrame;
  productMaturity: "live_product" | "concept_prototype" | "unknown";
  complexityLevel: "simple_tools" | "moderate" | "complex_system" | "unknown";
  ownershipLevel: "owner" | "contributor" | "support" | "unknown";
}

function sanitizeParsedJob(job: ParsedJob): ParsedJob {
  return {
    ...job,
    title: sanitizeTextValue(job.title),
    company: sanitizeTextValue(job.company),
    seniority: sanitizeTextValue(job.seniority),
    domain: sanitizeTextValue(job.domain),
    requiredSkills: sanitizeTextList(job.requiredSkills),
    preferredSkills: sanitizeTextList(job.preferredSkills),
    responsibilities: sanitizeTextList(job.responsibilities),
    keywords: sanitizeTextList(job.keywords),
    criticalKeywords: sanitizeTextList(job.criticalKeywords),
    intentions: sanitizeTextList(job.intentions),
    roleFrame: {
      workObjects: sanitizeTextList(job.roleFrame.workObjects),
      deliverables: sanitizeTextList(job.roleFrame.deliverables),
      decisions: sanitizeTextList(job.roleFrame.decisions),
      collaborators: sanitizeTextList(job.roleFrame.collaborators),
      environments: sanitizeTextList(job.roleFrame.environments),
      scopeSignals: sanitizeTextList(job.roleFrame.scopeSignals),
    },
  };
}
export interface ScoredBullet { bullet: Bullet; experience: Experience; deterministicScore: number; llmScore: number; semanticScore: number; totalScore: number; matchedTags: string[]; matchedKeywords: string[]; dimension: string; embedding?: number[]; }
export interface ScoredExperience { experience: Experience; score: number; reason: string; matchedAspects: string[]; selectedBullets: ScoredBullet[]; charBudget: number; }
export interface CompositionPlan { targetTitle: string; summary: string; sections: { experience: Experience; experienceScore: number; experienceReason: string; bullets: ScoredBullet[]; }[]; relevantSkills: string[]; rejectedBullets: { text: string; score: number; reason: string }[]; rejectedExperiences: { title: string; company: string; score: number; reason: string }[]; }
// Une retouche = une phrase modifiée par un modèle, toujours réversible par l'utilisateur.
export interface CvRewrite { target: "summary" | "bullet"; experienceIndex?: number; bulletIndex?: number; original: string; rewritten: string; reason: string; reverted?: boolean; }
export interface StructuredCV { name?: string; targetTitle: string; summary: string; summarySource?: "profile" | "generated"; experiences: { title: string; company: string; contractType?: string; dates: string; bullets: string[]; description?: string; }[]; skills: string[]; formations: { degree: string; school: string; year?: string }[]; languages: { name: string; level?: string }[]; rewrites?: CvRewrite[]; }

function sanitizeStructuredCV(cv: StructuredCV): StructuredCV {
  return {
    ...cv,
    name: sanitizeOptionalTextValue(cv.name),
    targetTitle: sanitizeTextValue(cv.targetTitle),
    summary: sanitizeTextValue(cv.summary),
    experiences: cv.experiences.map(exp => ({
      ...exp,
      title: sanitizeTextValue(exp.title),
      company: sanitizeTextValue(exp.company),
      contractType: sanitizeOptionalTextValue(exp.contractType),
      dates: sanitizeTextValue(exp.dates),
      bullets: exp.bullets.map(sanitizeTextValue),
      description: sanitizeOptionalTextValue(exp.description),
    })),
    skills: sanitizeTextList(cv.skills),
    formations: cv.formations.map(f => ({
      degree: sanitizeTextValue(f.degree),
      school: sanitizeTextValue(f.school),
      year: sanitizeOptionalTextValue(f.year),
    })),
    languages: cv.languages.map(l => ({
      name: sanitizeTextValue(l.name),
      level: sanitizeOptionalTextValue(l.level),
    })),
  };
}

// ── Step 1: Parse Job (with intentions + positioning) ──
const stringList = z.array(z.union([z.string(), z.number()]).transform(String)).optional();
const PARSED_JOB_SCHEMA = z.object({
  title: z.string().optional(), company: z.string().optional(), seniority: z.string().optional(), domain: z.string().optional(),
  requiredSkills: stringList, preferredSkills: stringList, responsibilities: stringList,
  keywords: stringList, criticalKeywords: stringList, intentions: stringList,
  language: z.string().optional(), positioning: z.string().optional(),
  productMaturity: z.string().optional(), complexityLevel: z.string().optional(), ownershipLevel: z.string().optional(),
  roleFrame: z.object({
    workObjects: stringList, deliverables: stringList, decisions: stringList,
    collaborators: stringList, environments: stringList, scopeSignals: stringList,
  }).partial().optional(),
}).passthrough();

// Une même annonce est parsée au pré-check puis à la génération : on ne paie qu'une fois.
const parsedJobCache = new TtlCache<ParsedJob>(24 * 60 * 60 * 1000, 300);
export async function parseJobDescription(jobText: string, openai: OpenAI): Promise<ParsedJob> {
  const sanitizedJobText = sanitizeTextValue(jobText);
  log("parseJobDescription", `${sanitizedJobText.length} chars`);
  const cacheKey = contentHash(MODEL, sanitizedJobText);
  const cached = parsedJobCache.get(cacheKey);
  if (cached) {
    log("parseJobDescription CACHE HIT");
    return structuredClone(cached);
  }
  const p = await completeJson(openai, {
    model: MODEL,
    schema: PARSED_JOB_SCHEMA,
    messages: [
      { role: "system", content: `Extract structured info from a job posting. Return JSON:
- title, company, seniority (junior/mid/senior/lead/director), domain
- requiredSkills[], preferredSkills[], responsibilities[]
- keywords[] (10-20 ATS terms: concrete tools, technologies, methodologies — max 3 words each, NO soft skills, NO descriptive phrases)
- criticalKeywords[] (5-8 ROLE-DISCRIMINATING must-haves — CRITICAL RULE: choose terms that a professional from an ADJACENT but different field would NOT have. Examples:
  * For Product Owner: "Backlog Management", "Sprint Planning", "User Stories", "Roadmap" — NOT "User Research" (designers have this too)
  * For Product Designer: "Figma", "Prototyping", "Design System", "Usability Testing" — NOT "Stakeholder Management" (POs have this too)
  * For Chef de Projet: "Gestion de projet", "Planning", "Budget", "Reporting" — NOT "Product Discovery"
  * For Data Analyst: "SQL", "Python", "Data Viz", "Dashboard" — NOT "Analytics" (too generic)
  The goal: if someone with the wrong background reads these 5-8 keywords, they should immediately know they don't qualify.)
- language ("EN"/"FR")
- intentions[] (5-10 phrases: what the role REALLY needs beyond keywords. Ex: "structurer les pratiques design", "influencer les stakeholders", "mesurer l'impact business du design". VERBS + OUTCOMES.)
- positioning: "consultant" (conseil, accompagnement, formation) | "lead" (management, vision, equipe) | "ic" (craft, delivery) | "manager" (people management)
- roleFrame: {
  workObjects[] (3-6 concrete nouns / short phrases for what this role works on daily. Ex: "user flows", "cloud sourcing", "editorial calendar")
  deliverables[] (2-5 outputs produced by the role. Ex: "wireframes", "roadmap", "plan de transformation")
  decisions[] (2-5 decisions / arbitrages expected from the role. Ex: "priorisation produit", "arbitrage UX", "choix de sourcing")
  collaborators[] (2-5 stakeholders or teams. Ex: "PM", "DSI", "marketing", "clients")
  environments[] (2-5 business / technical contexts. Ex: "e-commerce", "banque", "DSI", "retail")
  scopeSignals[] (2-5 scope markers. Ex: "execution", "structuration", "conseil", "management")
}
Important: roleFrame must describe the REAL WORK in the body of the posting, not only the title. If the title is noisy but the body clearly points elsewhere, trust the body.
- productMaturity: "concept_prototype" if the role works in an innovation lab, explores concepts, prototypes ideas, emerging tech, AI-driven concepts, with NO mention of live users, scale, production constraints, or shipping cadence; "live_product" if the role ships to real users, mentions an existing product, scale, metrics, or iterating on a live system; "unknown" if unclear.
- complexityLevel: "simple_tools" if the product targets SMBs or individual users and the copy uses words like "simple", "simplify", "easy", "daily ops" WITHOUT multi-account/role/permission complexity; "complex_system" if the product involves multi-account, multi-role, permissions, enterprise workflows, B2B platform, internal ops at scale, or data-heavy admin interfaces; "moderate" otherwise; "unknown" if unclear.
- ownershipLevel: "owner" if dominant verbs are lead, define, structure, redesign, own, drive, decide — real end-to-end accountability; "support" if dominant verbs are iterate, align, support, assist, contribute to, help maintain — no clear ownership signal; "contributor" otherwise; "unknown" if unclear.` },
      { role: "user", content: sanitizedJobText.slice(0, 6000) },
    ],
    temperature: 0,
  });
  const result = sanitizeParsedJob({
    title: p.title || "Unknown", company: p.company || "Unknown", seniority: p.seniority || "mid",
    domain: p.domain || "General", requiredSkills: p.requiredSkills || [], preferredSkills: p.preferredSkills || [],
    responsibilities: p.responsibilities || [], keywords: p.keywords || [],
    criticalKeywords: p.criticalKeywords || (p.keywords || []).slice(0, 5),
    language: p.language === "FR" ? "FR" : "EN",
    intentions: p.intentions || [],
    positioning: (["consultant", "lead", "ic", "manager"].includes(p.positioning ?? "") ? p.positioning : "ic") as any,
    productMaturity: (["live_product", "concept_prototype", "unknown"].includes(p.productMaturity ?? "") ? p.productMaturity : "unknown") as any,
    complexityLevel: (["simple_tools", "moderate", "complex_system", "unknown"].includes(p.complexityLevel ?? "") ? p.complexityLevel : "unknown") as any,
    ownershipLevel: (["owner", "contributor", "support", "unknown"].includes(p.ownershipLevel ?? "") ? p.ownershipLevel : "unknown") as any,
    roleFrame: {
      workObjects: uniqueItems(p.roleFrame?.workObjects || []),
      deliverables: uniqueItems(p.roleFrame?.deliverables || []),
      decisions: uniqueItems(p.roleFrame?.decisions || []),
      collaborators: uniqueItems(p.roleFrame?.collaborators || []),
      environments: uniqueItems(p.roleFrame?.environments || [p.domain || ""]),
      scopeSignals: uniqueItems(p.roleFrame?.scopeSignals || [p.positioning || ""]),
    },
  });
  result.requiredSkills = uniqueItems(result.requiredSkills.filter(skill => !isNoisyCriticalKeyword(skill)));
  result.preferredSkills = uniqueItems(result.preferredSkills.filter(skill => !isNoisyCriticalKeyword(skill)));
  result.keywords = uniqueItems(result.keywords.filter(keyword => !isNoisyCriticalKeyword(keyword)));
  result.criticalKeywords = buildStableCriticalKeywords(result);
  log("parseJobDescription DONE", { title: result.title, positioning: result.positioning, intentions: result.intentions.length, roleFrame: result.roleFrame });
  const final = sanitizeParsedJob(result);
  parsedJobCache.set(cacheKey, final);
  return structuredClone(final);
}

// ── Step 2: Hybrid Score ──
function inferDimension(tags: string[]): string {
  const t = tags.map(x => x.toLowerCase());
  if (t.some(x => ["impact","chiffres","resultats","metrics","kpi","conversion","revenue"].includes(x))) return "impact";
  if (t.some(x => ["collaboration","stakeholders","equipe","alignement","communication"].includes(x))) return "collaboration";
  if (t.some(x => ["leadership","management","mentorat","recrutement","lead"].includes(x))) return "leadership";
  if (t.some(x => ["methode","process","agile","discovery","research","user-research"].includes(x))) return "methode";
  if (t.some(x => ["deploiement","delivery","lancement","migration","rollout"].includes(x))) return "delivery";
  return "craft";
}

export function deterministicScore(bullet: Bullet, experience: Experience, allKw: string[], critKw: string[], intentions: string[]): { score: number; matchedTags: string[]; matchedKeywords: string[] } {
  const tags = (bullet.tags || []).filter(Boolean).map(t => t.toLowerCase());
  const text = bullet.text.toLowerCase();
  const desc = (experience.description || "").toLowerCase();
  const tagsText = tags.join(" ");
  let score = 5;
  const mTags: string[] = []; const mKw: string[] = [];

  for (const tag of tags) {
    for (const kw of allKw) {
      if (textHasKeyword(tag, kw) || textHasKeyword(kw, tag) || tag === kw.toLowerCase()) {
        score += 8;
        mTags.push(tag);
        mKw.push(kw.trim());
        break;
      }
    }
  }
  for (const ck of critKw) {
    if (textHasKeyword(text, ck) || textHasKeyword(tagsText, ck)) {
      score += 6;
      const label = ck.trim();
      if (!mKw.includes(label)) mKw.push(label);
    }
  }
  for (const kw of allKw) {
    if (textHasKeyword(text, kw)) {
      const label = kw.trim();
      if (!mKw.includes(label)) {
        score += 5;
        mKw.push(label);
      }
    }
  }
  // Description context boost
  for (const kw of allKw) {
    const label = kw.trim();
    if (textHasKeyword(desc, kw) && !mKw.includes(label)) {
      score += 2;
    }
  }
  // Intention matching
  for (const intent of intentions) {
    const words = intent.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    if (words.filter(w => text.includes(w) || tags.some(t => t.includes(w))).length >= 2) score += 4;
  }
  if (tags.length > 0 && !tags.every(t => ["imported","libre","general"].includes(t))) score += 5;
  if (/\d+/.test(bullet.text)) score += 3;
  // Cap 60 (au lieu de 70) : le matching lexical ne doit plus dominer la sélection
  // face au signal sémantique (LLM 0-60 + embeddings 0-30).
  return { score: Math.min(60, score), matchedTags: [...new Set(mTags)], matchedKeywords: [...new Set(mKw)] };
}

// ─── Semantic scoring via embeddings ─────────────────────────────────────────
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

async function embedTexts(texts: string[], openai: OpenAI): Promise<number[][]> {
  const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: texts });
  // L'API renvoie dans l'ordre des inputs, mais on trie par index par sécurité.
  return [...res.data].sort((x, y) => x.index - y.index).map(d => d.embedding);
}

function buildJobFacets(job: ParsedJob): string[] {
  const facets = [
    `${job.title} — ${job.domain}`,
    ...job.intentions,
    ...job.responsibilities,
    ...job.roleFrame.workObjects,
    ...job.roleFrame.deliverables,
    ...job.roleFrame.decisions,
  ].map(f => (f || "").trim()).filter(f => f.length >= 8);
  return uniqueItems(facets).slice(0, 30);
}

// Similarité cosine max bullet↔facettes de l'offre, remappée sur 0-30 points.
// En dessous de 0.30 de cosine : bruit, 0 point. Au dessus de 0.72 : plein score.
function semanticPointsFromSimilarity(sim: number): number {
  const normalized = Math.max(0, Math.min(1, (sim - 0.30) / (0.72 - 0.30)));
  return Math.round(normalized * 30);
}

/** Cache persistant des embeddings de bullets (fourni par la couche stockage). */
export interface EmbeddingStore {
  load(): Promise<Map<string, { key: string; vector: number[] }>>;
  save(entries: { id: string; key: string; vector: number[] }[]): Promise<void>;
}

function bulletEmbeddingText(sb: ScoredBullet): string {
  return `${sb.experience.title}. ${sb.bullet.text}${(sb.bullet.tags || []).length ? ` (${(sb.bullet.tags || []).join(", ")})` : ""}`;
}

async function applySemanticScores(scored: ScoredBullet[], job: ParsedJob, openai: OpenAI, store?: EmbeddingStore): Promise<void> {
  const facets = buildJobFacets(job);
  if (facets.length === 0 || scored.length === 0) return;
  try {
    const cached = store ? await store.load().catch(() => new Map<string, { key: string; vector: number[] }>()) : new Map<string, { key: string; vector: number[] }>();
    const keys = scored.map(sb => contentHash(EMBEDDING_MODEL, bulletEmbeddingText(sb)));
    const missing = scored.map((_, i) => i).filter(i => cached.get(scored[i].bullet.id)?.key !== keys[i]);
    // Un seul appel : les facettes de l'offre + les bullets jamais (ou plus) embeddés.
    const embeddings = await embedTexts([...facets, ...missing.map(i => bulletEmbeddingText(scored[i]))], openai);
    const facetEmbeddings = embeddings.slice(0, facets.length);
    const fresh = embeddings.slice(facets.length);
    const toSave: { id: string; key: string; vector: number[] }[] = [];
    missing.forEach((i, j) => {
      if (fresh[j]) toSave.push({ id: scored[i].bullet.id, key: keys[i], vector: fresh[j] });
    });
    const byIndex = new Map<number, number[]>();
    missing.forEach((i, j) => { if (fresh[j]) byIndex.set(i, fresh[j]); });
    for (let i = 0; i < scored.length; i++) {
      const emb = byIndex.get(i) || cached.get(scored[i].bullet.id)?.vector;
      if (!emb) continue;
      scored[i].embedding = emb;
      let best = 0;
      for (const facetEmb of facetEmbeddings) {
        const sim = cosineSimilarity(emb, facetEmb);
        if (sim > best) best = sim;
      }
      scored[i].semanticScore = semanticPointsFromSimilarity(best);
      scored[i].totalScore = scored[i].deterministicScore + scored[i].llmScore + scored[i].semanticScore;
    }
    if (store && toSave.length > 0) {
      await store.save(toSave).catch((e: any) => log("embeddings SAVE FAILED", e.message));
    }
    log("semanticScores DONE", { facets: facets.length, bullets: scored.length, embedded: missing.length });
  } catch (e: any) {
    // Fallback silencieux : le CV tient sans la composante sémantique.
    log("semanticScores FAILED (fallback lexical)", e.message);
  }
}

export async function hybridScoreAllBullets(parsedJob: ParsedJob, allExps: Experience[], allBullets: Bullet[], openai: OpenAI, store?: EmbeddingStore): Promise<ScoredBullet[]> {
  log("hybridScore", `${allBullets.length} bullets, ${allExps.length} exps`);
  if (allBullets.length === 0) return [];
  const expMap = new Map(allExps.map(e => [e.id, e]));
  const allKw = [...parsedJob.keywords, ...parsedJob.requiredSkills, ...parsedJob.preferredSkills];

  const scored = allBullets.map(b => {
    const exp = expMap.get(b.experienceId);
    if (!exp) return null;
    const det = deterministicScore(b, exp, allKw, parsedJob.criticalKeywords, parsedJob.intentions);
    return { bullet: b, experience: exp, deterministicScore: det.score, llmScore: 0, semanticScore: 0, totalScore: det.score, matchedTags: det.matchedTags, matchedKeywords: det.matchedKeywords, dimension: inferDimension((b.tags || []).filter(Boolean)) } as ScoredBullet;
  }).filter(Boolean) as ScoredBullet[];

  // Composante sémantique (embeddings) AVANT le pré-filtre top-N : les bullets
  // pertinents sans keywords exacts ne sont plus éliminés avant que le LLM les voie.
  await applySemanticScores(scored, parsedJob, openai, store);

  const toScore = scored.length <= 60
    ? scored
    : [...scored].sort((a, b) => (b.deterministicScore + b.semanticScore) - (a.deterministicScore + a.semanticScore)).slice(0, 60);
  if (toScore.length > 0) {
    const list = toScore.map((sb, i) => `[${i}] (${sb.experience.title} @ ${sb.experience.company}): ${sb.bullet.text}${(sb.bullet.tags||[]).length ? ` [${(sb.bullet.tags||[]).join(",")}]` : ""}`).join("\n");
    try {
      const r = await completeJson(openai, {
        model: MODEL,
        schema: z.object({ scores: z.array(z.object({ index: z.number().int(), score: z.number() })) }),
        temperature: 0,
        messages: [
          { role: "system", content: `Score each CV bullet 0-60 for relevance to the target job. Consider:
1. Direct skill match 2. Transferable competencies 3. Impact/metrics 4. Seniority alignment
5. POSITIONING: this is a ${parsedJob.positioning} role. Bullets showing ${parsedJob.positioning === "consultant" ? "accompagnement, structuration, formation, conseil" : parsedJob.positioning === "lead" ? "vision, leadership, strategie" : "delivery, craft, conception"} score HIGHER.
6. Intent match: the job needs someone who can: ${parsedJob.intentions.slice(0, 5).join("; ")}
Score generously for bullets matching the SPIRIT of the role.` },
          { role: "user", content: `Target: "${parsedJob.title}" at "${parsedJob.company}" (${parsedJob.domain})\nRequired: ${parsedJob.requiredSkills.join(", ")}\nResponsibilities: ${parsedJob.responsibilities.slice(0,5).join(", ")}\n\nBullets:\n${list}\n\nReturn JSON: {"scores": [{"index": 0, "score": 0-60}]}` },
        ],
      });
      for (const s of r.scores) { if (s.index >= 0 && s.index < toScore.length) { toScore[s.index].llmScore = Math.max(0, Math.min(60, s.score || 0)); toScore[s.index].totalScore = toScore[s.index].deterministicScore + toScore[s.index].llmScore + toScore[s.index].semanticScore; } }
    } catch (e: any) { log("hybridScore LLM failed", e.message); }
  }
  scored.sort((a, b) => b.totalScore - a.totalScore);
  log("hybridScore DONE", scored.slice(0, 5).map(s => ({ s: s.totalScore, c: s.experience.company, t: s.bullet.text.slice(0, 50) })));
  return scored;
}

// ── Step 3: Budget Allocator (pertinence-weighted) ──
interface BudgetAlloc { experience: Experience; charBudget: number; maxBullets: number; importance: "critical" | "standard" | "minimal"; }
type SelectionStrategy = "faithful" | "optimized";
type ProofPriority =
  | "leadership"
  | "people_management"
  | "product_ownership"
  | "data_workflows"
  | "research"
  | "design_system"
  | "mobile";

interface SelectBulletsOptions {
  strategy?: SelectionStrategy;
}

export function allocateCharBudget(exps: Experience[], scored: ScoredBullet[], totalChars: number): BudgetAlloc[] {
  const OVERHEAD = 500; const EXP_HEADER = 80;
  const pool = totalChars - OVERHEAD - exps.length * EXP_HEADER;
  const sorted = [...exps].sort((a, b) => { const dA = a.endDate ? new Date(a.endDate).getTime() : Date.now(); const dB = b.endDate ? new Date(b.endDate).getTime() : Date.now(); return dB - dA; });

  const expData = sorted.map(exp => {
    const bullets = scored.filter(sb => sb.experience.id === exp.id);
    const avg = bullets.length > 0 ? bullets.reduce((s, b) => s + b.totalScore, 0) / bullets.length : 0;
    const best = bullets.length > 0 ? Math.max(...bullets.map(b => b.totalScore)) : 0;
    const strongBullets = bullets.filter(b => b.totalScore >= 30).length;
    const end = exp.endDate ? new Date(exp.endDate) : new Date();
    const years = (Date.now() - end.getTime()) / (365.25 * 24 * 3600 * 1000);
    const recency = years <= 1 ? 1.5 : years <= 3 ? 1.2 : years <= 5 ? 1.0 : 0.7;
    const pertinence = (best * 0.4 + avg * 0.3 + strongBullets * 8 * 0.3);
    const minScore = years <= 5 ? 10 : 2;
    return { exp, score: Math.max(minScore, pertinence * recency), years, bulletCount: bullets.length, strongBullets };
  });

  // Budget mode: compact (≤2000) = impact only, standard (2001-3000) = balanced, rich (>3000) = storytelling
  const budgetMode: "compact" | "standard" | "rich" = totalChars <= 2000 ? "compact" : totalChars <= 3000 ? "standard" : "rich";

  const totalScore = expData.reduce((s, e) => s + e.score, 0);
  return expData.map(ed => {
    const prop = ed.score / totalScore;
    let budget = Math.round(pool * prop);
    const minBudget = ed.years <= 5 ? 250 : 120;
    budget = Math.max(minBudget, Math.min(Math.round(pool * 0.4), budget));

    // Adaptive maxBullets: compact = impact bullets only, rich = allow storytelling
    let maxB: number;
    if (budgetMode === "compact") {
      // Only strong bullets (score ≥ 30 or has numbers)
      maxB = Math.max(1, Math.min(ed.strongBullets, Math.floor(budget / 120)));
    } else if (budgetMode === "rich") {
      // Allow more bullets including context/storytelling
      maxB = Math.max(1, Math.min(Math.max(ed.bulletCount, 2), Math.floor(budget / 80)));
    } else {
      maxB = Math.max(1, Math.min(Math.max(ed.strongBullets, 1), Math.floor(budget / 100)));
    }

    const imp: "critical" | "standard" | "minimal" = ed.score > totalScore * 0.2 ? "critical" : ed.years > 6 ? "minimal" : "standard";
    return { experience: ed.exp, charBudget: budget, maxBullets: maxB, importance: imp };
  });
}

// ── Narrative dedup helpers ──
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter(w => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

function tokenizeNormalized(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter(w => w.length >= 4),
  );
}

function countDirectKeywordMatches(text: string, tags: string[], keywords: string[]): number {
  const evidenceText = `${text} ${(tags || []).join(" ")}`;
  return keywords.filter(keyword => textHasKeyword(evidenceText, keyword)).length;
}

function detectSelectionPriorities(job: ParsedJob): ProofPriority[] {
  const signals = normalizeEvidenceText([
    job.title,
    job.company,
    job.domain,
    ...job.requiredSkills,
    ...job.preferredSkills,
    ...job.responsibilities,
    ...job.criticalKeywords,
  ].join(" "));

  const priorities: ProofPriority[] = [];
  if (/\b(lead|head|director|leadership|vision|strategy|strategie)\b/.test(signals)) priorities.push("leadership");
  if (/\b(team management|people management|management d equipe|manage designers|grow the design team|faire grandir|mentoring)\b/.test(signals)) priorities.push("people_management");
  if (/\b(product management|product owner|roadmap|prioritization|priorisation|backlog|okr|kpi|crm)\b/.test(signals)) priorities.push("product_ownership");
  if (/\b(data|analytics|dashboard|workflow|backoffice|data products|football|match analysis|visualization|visualisation|dense en donnees)\b/.test(signals)) priorities.push("data_workflows");
  if (/\b(user research|research|interviews|tests utilisateurs|usability)\b/.test(signals)) priorities.push("research");
  if (/\b(design system|guidelines|component|components)\b/.test(signals)) priorities.push("design_system");
  if (/\b(mobile|ios|android|native app|human interface guidelines|material design)\b/.test(signals)) priorities.push("mobile");
  return uniqueItems(priorities).slice(0, 4) as ProofPriority[];
}

function bulletMatchesPriority(sb: ScoredBullet, priority: ProofPriority): boolean {
  const evidenceText = `${sb.bullet.text} ${sb.experience.description || ""} ${(sb.bullet.tags || []).join(" ")}`;
  switch (priority) {
    case "leadership":
      return /\b(lead ux|lead designer|leadership|vision produit|vision design|strategie|strategy|alignement|structuration)\b/i.test(evidenceText);
    case "people_management":
      return /\b(team management|people management|management d equipe|manager|mentor|mentorat|coaching|hiring|recrutement|faire grandir)\b/i.test(evidenceText);
    case "product_ownership":
      return /\b(product strategy|vision produit|roadmap|priorisation|prioritization|backlog|okr|kpi|crm|product discovery|arbitrage produit)\b/i.test(evidenceText);
    case "data_workflows":
      return /\b(data|analytics|dashboard|workflow|backoffice|audit|analyse|analysis|dense en donnees|decision|crm)\b/i.test(evidenceText);
    case "research":
      return /\b(interviews? utilisateurs?|user research|tests utilisateurs|usability|insights)\b/i.test(evidenceText);
    case "design_system":
      return /\b(design system|guidelines|components?|figma)\b/i.test(evidenceText);
    case "mobile":
      return /\b(mobile|ios|android|app iOS|app android)\b/i.test(evidenceText);
    default:
      return false;
  }
}

function getBulletSelectionSignals(sb: ScoredBullet, job: ParsedJob): {
  directCriticalMatches: number;
  roleFrameMatches: number;
  priorityMatches: number;
  specificityBoost: number;
  hasNumber: boolean;
  isGenericBridge: boolean;
} {
  const tags = (sb.bullet.tags || []).filter(Boolean);
  const directCriticalMatches = countDirectKeywordMatches(sb.bullet.text, tags, job.criticalKeywords);
  const roleFrameMatches = countDirectKeywordMatches(
    `${sb.bullet.text} ${sb.experience.description || ""}`,
    tags,
    [...job.roleFrame.workObjects, ...job.roleFrame.deliverables, ...job.roleFrame.decisions],
  );
  const selectionPriorities = detectSelectionPriorities(job);
  const priorityMatches = selectionPriorities.filter(priority => bulletMatchesPriority(sb, priority)).length;
  const hasNumber = /\d/.test(sb.bullet.text);
  const isGenericBridge =
    directCriticalMatches === 0
    && roleFrameMatches === 0
    && priorityMatches === 0
    && sb.matchedKeywords.length === 0
    && !hasNumber;

  let specificityBoost =
    directCriticalMatches * 10
    + Math.min(4, sb.matchedKeywords.length) * 3
    + Math.min(3, roleFrameMatches) * 2
    + priorityMatches * 5
    + (hasNumber ? 2 : 0);

  if ((job.positioning === "lead" || job.positioning === "manager") && sb.dimension === "leadership") {
    specificityBoost += 6;
  } else if (job.positioning === "ic" && (sb.dimension === "impact" || sb.dimension === "delivery")) {
    specificityBoost += 3;
  }

  if (isGenericBridge) specificityBoost -= 5;

  return {
    directCriticalMatches,
    roleFrameMatches,
    priorityMatches,
    specificityBoost,
    hasNumber,
    isGenericBridge,
  };
}

// ── Step 4: Select & Deduplicate ──
export function selectBullets(scored: ScoredBullet[], allocs: BudgetAlloc[], job: ParsedJob, options?: SelectBulletsOptions): ScoredExperience[] {
  const strategy = options?.strategy || "faithful";
  // First pass: select per experience
  const result = allocs.map(alloc => {
    // Compteur de dimensions PAR EXPÉRIENCE (un compteur global pénalisait les
    // bullets "craft" des expériences suivantes et laissait des expériences vides).
    const dimCounts = new Map<string, number>();
    const bullets = scored
      .filter(sb => sb.experience.id === alloc.experience.id)
      .sort((a, b) => {
        const aSignals = getBulletSelectionSignals(a, job);
        const bSignals = getBulletSelectionSignals(b, job);
        const aBoost = strategy === "optimized"
          ? aSignals.specificityBoost + aSignals.priorityMatches * 6 - (aSignals.isGenericBridge ? 6 : 0)
          : aSignals.specificityBoost;
        const bBoost = strategy === "optimized"
          ? bSignals.specificityBoost + bSignals.priorityMatches * 6 - (bSignals.isGenericBridge ? 6 : 0)
          : bSignals.specificityBoost;
        return (b.totalScore + bBoost) - (a.totalScore + aBoost);
      });
    const sel: ScoredBullet[] = []; let chars = 0;
    let genericBridgeCount = 0;
    for (const sb of bullets) {
      const signals = getBulletSelectionSignals(sb, job);
      if (sel.length >= alloc.maxBullets) break;
      if (chars + sb.bullet.text.length > alloc.charBudget && sel.length > 0) break;
      const dc = dimCounts.get(sb.dimension) || 0;
      if (dc >= 2 && signals.directCriticalMatches === 0 && sb.totalScore < 40) continue;
      if (alloc.importance === "minimal" && signals.isGenericBridge && sb.totalScore < 60) continue;
      if (genericBridgeCount >= 1 && signals.isGenericBridge && signals.specificityBoost < 4) continue;
      if (sel.length >= 2 && signals.directCriticalMatches === 0 && signals.roleFrameMatches === 0 && !signals.hasNumber && sb.totalScore < 65) continue;
      if (strategy === "optimized") {
        // 72: in optimized mode a generic bridge bullet (no direct match, no priority)
        // needs a minimum quality floor — below this it adds noise rather than signal.
        if (signals.isGenericBridge && signals.priorityMatches === 0 && sb.totalScore < 72) continue;
        // 70: after the first selected bullet, weak bullets with no keyword signal
        // and no numbers are filtered out to keep the optimized selection tight.
        if (sel.length >= 1 && signals.directCriticalMatches === 0 && signals.priorityMatches === 0 && !signals.hasNumber && sb.totalScore < 70) continue;
      }
      sel.push(sb); chars += sb.bullet.text.length;
      dimCounts.set(sb.dimension, dc + 1);
      if (signals.isGenericBridge) genericBridgeCount += 1;
    }
    const avg = sel.length > 0 ? sel.reduce((s, b) => s + b.totalScore, 0) / sel.length : 0;
    return { experience: alloc.experience, score: avg, reason: alloc.importance === "critical" ? "Highly relevant" : alloc.importance === "minimal" ? "Timeline continuity" : "Relevant", matchedAspects: [...new Set(sel.flatMap(sb => sb.matchedKeywords))], selectedBullets: sel, charBudget: alloc.charBudget };
  });

  if (strategy === "optimized") {
    const priorities = detectSelectionPriorities(job);
    const selectedIds = new Set(result.flatMap(se => se.selectedBullets.map(sb => sb.bullet.id)));
    const selectedCoverage = new Set(
      result.flatMap(se => se.selectedBullets.flatMap(sb => priorities.filter(priority => bulletMatchesPriority(sb, priority))))
    );

    for (const priority of priorities) {
      if (selectedCoverage.has(priority)) continue;
      const candidate = scored
        .filter(sb => !selectedIds.has(sb.bullet.id) && bulletMatchesPriority(sb, priority))
        .sort((a, b) => {
          const aSignals = getBulletSelectionSignals(a, job);
          const bSignals = getBulletSelectionSignals(b, job);
          return (b.totalScore + bSignals.specificityBoost + bSignals.priorityMatches * 8)
            - (a.totalScore + aSignals.specificityBoost + aSignals.priorityMatches * 8);
        })[0];

      if (!candidate) continue;

      const target = result.find(se => se.experience.id === candidate.experience.id)
        || result.find(se => se.selectedBullets.some(sb => getBulletSelectionSignals(sb, job).isGenericBridge));

      if (!target) continue;

      const currentChars = target.selectedBullets.reduce((sum, sb) => sum + sb.bullet.text.length, 0);
      const weakest = target.selectedBullets
        .map(sb => ({ sb, signals: getBulletSelectionSignals(sb, job) }))
        .sort((a, b) => (a.sb.totalScore + a.signals.specificityBoost) - (b.sb.totalScore + b.signals.specificityBoost))[0];

      if (target.selectedBullets.length === 0 || currentChars + candidate.bullet.text.length <= target.charBudget) {
        target.selectedBullets.push(candidate);
      } else if (
        weakest
        // Minimum absolute quality floor: a priority-gap candidate must score at least
        // 30 to be worth displacing any existing bullet (avoids injecting garbage).
        && candidate.totalScore >= 30
        && (
          weakest.signals.isGenericBridge
          || (candidate.totalScore + getBulletSelectionSignals(candidate, job).specificityBoost + 8)
            > (weakest.sb.totalScore + weakest.signals.specificityBoost + weakest.signals.priorityMatches * 6)
        )
      ) {
        target.selectedBullets = target.selectedBullets.filter(sb => sb.bullet.id !== weakest.sb.bullet.id);
        target.selectedBullets.push(candidate);
      }

      selectedIds.add(candidate.bullet.id);
      selectedCoverage.add(priority);
    }
  }

  // Second pass: cross-experience narrative dedup.
  // Cosine embeddings (> 0.88) quand disponible, fallback Jaccard (> 0.45).
  const seenTokens: Set<string>[] = [];
  const seenEmbeddings: number[][] = [];
  for (const se of result) {
    se.selectedBullets = se.selectedBullets.filter(sb => {
      const tokens = tokenizeNormalized(sb.bullet.text);
      const tooSimilarLexical = seenTokens.some(prev => jaccardSimilarity(prev, tokens) > 0.45);
      const tooSimilarSemantic = !!sb.embedding
        && seenEmbeddings.some(prev => cosineSimilarity(prev, sb.embedding!) > 0.88);
      const tooSimilar = tooSimilarLexical || tooSimilarSemantic;
      if (!tooSimilar) {
        seenTokens.push(tokens);
        if (sb.embedding) seenEmbeddings.push(sb.embedding);
      }
      return !tooSimilar;
    });
  }
  return result;
}

// ── Step 5: Build Structured CV (adaptive) ──
export async function buildStructuredCV(job: ParsedJob, selExps: ScoredExperience[], skills: Skill[], mode: string, openai: OpenAI, extras?: { profileName?: string; profileTitle?: string; profileSummary?: string; formations?: any[]; languages?: any[] }): Promise<StructuredCV> {
  const allKw = [...job.requiredSkills, ...job.preferredSkills, ...job.keywords].map(k => k.toLowerCase());
  const allTags = selExps.flatMap(se => se.selectedBullets.flatMap(sb => (sb.bullet.tags || []).filter(Boolean).map(t => t.toLowerCase())));
  const relSkills = skills.filter(s => { const sl = s.name.toLowerCase(); return allKw.some(k => k.includes(sl) || sl.includes(k)) || allTags.some(t => t.includes(sl) || sl.includes(t)); }).map(s => s.name).slice(0, 12);
  const seen = new Set<string>(); const dedupSkills = relSkills.filter(s => { const l = normalizeSkillKey(s); if (seen.has(l)) return false; seen.add(l); return true; });

  let summary = extras?.profileSummary || "";
  let summarySource: StructuredCV["summarySource"] = summary ? "profile" : "generated";
  const topExps = selExps.filter(se => se.selectedBullets.length > 0).slice(0, 3);
  const posGuide: Record<string, string> = {
    consultant: "Emphasize: conseil, accompagnement, structuration des pratiques, montee en maturite design. NEVER claim: team management, hiring, product ownership, or technical leadership unless the bullets prove it.",
    lead: "Emphasize: vision, leadership, design strategy, scope coordination. NEVER claim: people management, hiring, org design, or C-level influence unless the bullets prove it.",
    ic: "Emphasize: craft, delivery, impact, technical expertise. NEVER claim: team management, strategy ownership, org design, or hiring unless the bullets prove it.",
    manager: "Emphasize: people management, hiring, team growth, org design. NEVER claim: hands-on craft delivery or technical architecture unless the bullets prove it.",
  };
  const proofHighlights = topExps
    .flatMap(se => se.selectedBullets.slice(0, 2).map(sb => sb.bullet.text))
    .slice(0, 5)
    .join(" | ");
  const modeGuide = mode === "optimized"
    ? "Optimized-human mode: choose the most legitimate angle for this role, make the strongest proved fit obvious, and avoid generic summary fluff. Never claim management, team building, head scope, strategy ownership, or domain expertise unless the selected bullets prove it explicitly."
    : "Faithful mode: stay very close to the source profile and keep the framing prudent.";
  // Mode fidèle : le résumé écrit par l'utilisateur est repris tel quel, sans IA.
  const keepUserSummary = mode !== "optimized" && !!summary;
  if (topExps.length > 0 && !keepUserSummary) {
    summarySource = "generated";
    try {
      const res = await openai.chat.completions.create({ model: WRITER_MODEL, temperature: WRITER_TEMPERATURE, messages: [
        { role: "system", content: `Write a 2-3 sentence CV summary. Max 45 words, max 300 characters. No first person. ${posGuide[job.positioning]} ${modeGuide} ${job.language === "FR" ? "In French." : "In English."}
GROUNDING RULES:
- Only reference companies listed in the experiences below.
- Do not invent metrics, achievements, or projects not explicitly mentioned in the provided context.
- Only mention an expertise area (e.g. "design system", "user research", "data") if at least 2 of the proof highlights below demonstrate it concretely.
- Do not claim years of experience in a domain unless the experiences below span that duration.
- Write in flowing prose only; do NOT use labels like "Competences:" or "Skills:" in the text.
- Prefer specific, provable claims over generic positioning statements.` },
        { role: "user", content: `Target: "${job.title}" at "${job.company}" (${job.domain})\nMode: ${mode}\nPositioning: ${job.positioning}\n${extras?.profileSummary ? `Bio: ${extras.profileSummary}\n` : ""}Exps: ${topExps.map(se => `${se.experience.title} at ${se.experience.company}`).join(", ")}\nSkills: ${dedupSkills.slice(0,6).join(", ")}\nRequired: ${job.requiredSkills.slice(0,5).join(", ")}\nIntentions: ${job.intentions.slice(0,3).join("; ")}\nProof highlights: ${proofHighlights}` },
      ] });
      summary = (res.choices[0].message.content || summary).trim();
    } catch (e: any) {
      log("summary LLM failed - deterministic fallback", e.message);
      if (!summary) {
        const expStr = topExps.slice(0, 2).map(se => `${se.experience.title} chez ${se.experience.company}`).join(", ");
        const skillStr = dedupSkills.slice(0, 3).join(", ");
        summary = job.language === "FR"
          ? `Profil ${job.title} avec experience en ${expStr}${skillStr ? `. Competences : ${skillStr}` : ""}.`
          : `${job.title} profile with experience at ${expStr}${skillStr ? `. Skills: ${skillStr}` : ""}.`;
      }
    }
  }

  const fmtDate = (d: string | null | undefined, lang: string) => { if (!d) return "Present"; try { return new Date(d).toLocaleDateString(lang === "FR" ? "fr-FR" : "en-US", { month: "short", year: "numeric" }); } catch { return d; } };
  return sanitizeStructuredCV({
    // Titre : celui que l'utilisateur s'est donné, jamais celui de l'offre.
    name: extras?.profileName || undefined,
    targetTitle: extras?.profileTitle?.trim() || selExps.find(se => se.selectedBullets.length > 0)?.experience.title || "",
    summary, summarySource,
    experiences: selExps.map(se => ({ title: se.experience.title, company: se.experience.company, contractType: (se.experience as any).contractType || undefined, dates: `${fmtDate(se.experience.startDate, job.language)} - ${fmtDate(se.experience.endDate, job.language)}`, bullets: se.selectedBullets.map(sb => sb.bullet.text), description: se.experience.description || undefined })),
    skills: dedupSkills,
    formations: (extras?.formations || []).map((f: any) => ({ degree: f.degree, school: f.school, year: f.year })),
    languages: (extras?.languages || []).map((l: any) => ({ name: l.name, level: l.level })),
  });
}

function extractPreservationEntities(text: string): { numbers: string[]; properNouns: string[]; tools: string[] } {
  const numbers = (text.match(/\d[\d,.]*%?/g) || []).map(n => n.trim());
  const knownTools = [
    "figma", "sketch", "miro", "notion", "jira", "confluence", "hotjar", "mixpanel",
    "amplitude", "maze", "usertesting", "airtable", "invision", "zeplin", "abstract",
    "principle", "framer", "webflow", "react", "vue", "angular", "storybook",
    "contentful", "wordpress", "shopify", "salesforce", "hubspot", "intercom",
    "dovetail", "lookback", "productboard", "pendo", "fullstory", "contentsquare",
  ];
  const textLow = text.toLowerCase();
  const tools = knownTools.filter(tool => textLow.includes(tool));
  const properNouns = (text.match(/\b[A-Z][a-zà-ÿ]+(?:\s[A-Z][a-zà-ÿ]+)*/g) || [])
    .filter(noun => noun.length >= 3 && !["Le", "La", "Les", "Un", "Une", "Des", "Du", "De", "Au", "The", "And", "For", "With"].includes(noun));
  return { numbers, properNouns, tools };
}

function reformulationPreservesEntities(original: string, reformulated: string): boolean {
  const orig = extractPreservationEntities(original);
  const reformLow = reformulated.toLowerCase();
  for (const num of orig.numbers) {
    if (!reformulated.includes(num)) return false;
  }
  for (const tool of orig.tools) {
    if (!reformLow.includes(tool)) return false;
  }
  return true;
}

export interface RewriteCandidate { experienceIndex: number; bulletIndex: number; reason: string; }
export const MAX_REWRITES = 3;

/**
 * Contrôles déterministes appliqués à toute phrase réécrite par un modèle.
 * La consigne au modèle ne suffit pas : c'est ce code qui garantit l'ancrage.
 */
export function validateRewrite(original: string, rewritten: string, allowedVocabulary = ""): { ok: boolean; reason?: string } {
  const r = rewritten.trim();
  if (r.length < 40 || r.length > 200) return { ok: false, reason: "longueur hors limites" };
  const ratio = r.length / Math.max(1, original.length);
  if (ratio < 0.75 || ratio > 1.3) return { ok: false, reason: "longueur trop différente de l'original" };
  if (!reformulationPreservesEntities(original, r)) return { ok: false, reason: "chiffre ou outil perdu" };
  const origNumbers = new Set((original.match(/\d[\d,.]*%?/g) || []));
  if ((r.match(/\d[\d,.]*%?/g) || []).some(n => !origNumbers.has(n))) return { ok: false, reason: "chiffre ajouté" };
  const similarity = jaccardSimilarity(tokenizeNormalized(original), tokenizeNormalized(r));
  if (similarity < 0.4) return { ok: false, reason: "trop éloigné de l'original" };
  // Aucun nom propre nouveau qui ne vienne ni de l'original ni de l'offre
  const known = normalizeEvidenceText(`${original} ${allowedVocabulary}`);
  const newProper = (r.match(/\b[A-Z][a-zA-Zà-ÿ0-9]{2,}\b/g) || [])
    .filter((w, i) => i > 0 || !r.startsWith(w))
    .filter(w => !known.includes(normalizeEvidenceText(w)));
  if (newProper.length > 0) return { ok: false, reason: `nom propre introduit (${newProper[0]})` };
  return { ok: true };
}

/**
 * Retouche ciblée : au plus MAX_REWRITES bullets désignés par le moteur (ceux qui
 * prouvent une exigence de l'offre avec un autre vocabulaire), plus le résumé en
 * mode optimisé. Chaque retouche est tracée dans cv.rewrites et réversible.
 * Tout ce qui n'est pas désigné reste mot pour mot.
 */
export async function composeCVDocument(
  cv: StructuredCV,
  job: ParsedJob,
  openai: OpenAI,
  options: { candidates: RewriteCandidate[]; rewriteSummary: boolean },
): Promise<StructuredCV> {
  const candidates = options.candidates
    .filter(c => cv.experiences[c.experienceIndex]?.bullets[c.bulletIndex])
    .slice(0, MAX_REWRITES);
  if (candidates.length === 0 && !options.rewriteSummary) return cv;

  const rewrites: CvRewrite[] = [...(cv.rewrites || [])];
  const list = candidates.map((c, i) => {
    const exp = cv.experiences[c.experienceIndex];
    return `[${i}] (${exp.title} @ ${exp.company}${exp.description ? ` | context: ${exp.description.slice(0, 200)}` : ""}) — ${c.reason}: ${exp.bullets[c.bulletIndex]}`;
  }).join("\n");
  const langRule = job.language === "FR" ? "Write in French." : "Write in English.";
  const vocabulary = uniqueItems([...job.criticalKeywords, ...job.requiredSkills, ...job.keywords]).slice(0, 20);
  try {
    const res = await openai.chat.completions.create({
      model: WRITER_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `You make MINIMAL wording edits to a few CV lines so that a recruiter for the target role recognises what they already prove.

RULES (absolute):
- Change as few words as possible: swap the candidate's wording for the role's vocabulary ONLY when the line already proves that same thing.
- Keep the candidate's sentence structure and voice. Do not add adjectives, impact claims or buzzwords.
- Keep every number, tool, brand and proper noun exactly. Add none.
- Never change the nature or scope of the activity.
- Same length as the original, within 20%.
- If a line cannot be improved honestly, return it unchanged.
- ${langRule}` },
        { role: "user", content: `Target role: "${job.title}" (${job.positioning})
Role vocabulary (use only where honestly supported): ${vocabulary.join(", ")}

Lines to adjust:
${list || "(none)"}

${options.rewriteSummary ? `Also adjust this summary the same way (2-3 sentences, max 300 characters, no first person, no generic claims):\n${cv.summary || "(none)"}\n` : ""}
Return JSON: {"bullets": [{"index": 0, "text": "..."}]${options.rewriteSummary ? ', "summary": "..."' : ""}}` },
      ],
    });
    const r = JSON.parse(res.choices[0].message.content || "{}");
    const allowed = `${job.title} ${job.company} ${vocabulary.join(" ")}`;
    for (const rb of (r.bullets || [])) {
      const c = candidates[rb.index];
      if (!c || typeof rb.text !== "string") continue;
      const original = cv.experiences[c.experienceIndex].bullets[c.bulletIndex];
      const rewritten = rb.text.trim();
      if (rewritten === original) continue;
      const check = validateRewrite(original, rewritten, `${cv.experiences[c.experienceIndex].description || ""} ${allowed}`);
      if (!check.ok) { log("rewrite REJECTED", { reason: check.reason, original: original.slice(0, 80) }); continue; }
      cv.experiences[c.experienceIndex].bullets[c.bulletIndex] = rewritten;
      rewrites.push({ target: "bullet", experienceIndex: c.experienceIndex, bulletIndex: c.bulletIndex, original, rewritten, reason: c.reason });
    }
    const newSummary = String(r.summary || "").trim();
    if (options.rewriteSummary && newSummary && newSummary !== cv.summary
      && newSummary.length >= 40 && newSummary.length <= 320 && mojibakePenaltyScore(newSummary) === 0) {
      rewrites.push({ target: "summary", original: cv.summary, rewritten: newSummary, reason: "résumé orienté vers le poste" });
      cv.summary = newSummary;
      cv.summarySource = "generated";
    }
    log("compose DONE", { candidates: candidates.length, applied: rewrites.length });
  } catch (e: any) {
    // Échec du modèle : le CV reste exactement celui de l'utilisateur.
    log("compose FAILED (texte source conservé)", e.message);
  }
  cv.rewrites = rewrites;
  return sanitizeStructuredCV(cv);
}

/**
 * Désigne les bullets qui méritent une retouche : pertinents pour l'offre
 * (signal sémantique ou LLM) mais sans le vocabulaire attendu.
 */
export function pickRewriteCandidates(cv: StructuredCV, selExps: ScoredExperience[]): RewriteCandidate[] {
  const out: (RewriteCandidate & { score: number })[] = [];
  // buildStructuredCV conserve l'ordre de selExps : les index correspondent.
  selExps.forEach((se, ei) => {
    if (!cv.experiences[ei]) return;
    se.selectedBullets.forEach((sb, bi) => {
      const relevant = sb.semanticScore >= 15 || sb.llmScore >= 35;
      if (relevant && sb.matchedKeywords.length === 0) {
        out.push({ experienceIndex: ei, bulletIndex: bi, reason: "pertinent pour le poste mais formulé avec un autre vocabulaire", score: sb.totalScore });
      }
    });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, MAX_REWRITES).map(({ score, ...c }) => c);
}

// ── Step 7: Post Rules ──
export interface PostRuleResult {
  keywordsCovered: string[];
  keywordsMissing: string[];
  evidenceKeywordsCovered: string[];
  evidenceKeywordsMissing: string[];
  injectedKeywords: string[];
  longBullets: number;
  bulletsWithNumbers: number;
  totalBullets: number;
  rulesApplied: string[];
}
export function applyPostRules(cv: StructuredCV, job: ParsedJob): PostRuleResult {
  const rules: string[] = [];
  const initialText = [cv.summary, ...cv.experiences.flatMap(e => e.bullets), cv.skills.join(" ")].join(" ").toLowerCase();
  const missingBeforeInjection = job.criticalKeywords.filter(kw => !textHasKeyword(initialText, kw));
  const evidenceCovered = job.criticalKeywords.filter(kw => textHasKeyword(initialText, kw));
  // Aucune compétence n'est ajoutée au CV parce que l'offre la cite : les
  // mots-clés absents sont signalés dans le rapport, à l'utilisateur de décider.
  const injectedKeywords: string[] = [];
  let longCount = 0;
  for (const exp of cv.experiences) { for (let i = 0; i < exp.bullets.length; i++) { if (exp.bullets[i].length > 200) { exp.bullets[i] = exp.bullets[i].slice(0, 200).replace(/[,;]?\s*\S*$/, ""); longCount++; rules.push(`Truncated bullet in ${exp.company}`); } } }
  const total = cv.experiences.reduce((s, e) => s + e.bullets.length, 0);
  const withNums = cv.experiences.reduce((s, e) => s + e.bullets.filter(b => /\d+/.test(b)).length, 0);
  const finalText = [cv.summary, ...cv.experiences.flatMap(e => e.bullets), cv.skills.join(" ")].join(" ").toLowerCase();
  const covered: string[] = []; const missing: string[] = [];
  for (const kw of job.criticalKeywords) { (textHasKeyword(finalText, kw) ? covered : missing).push(kw); }
  return {
    keywordsCovered: covered,
    keywordsMissing: missing,
    evidenceKeywordsCovered: evidenceCovered,
    evidenceKeywordsMissing: missingBeforeInjection,
    injectedKeywords,
    longBullets: longCount,
    bulletsWithNumbers: withNums,
    totalBullets: total,
    rulesApplied: rules,
  };
}

// ── Step 8: Render ──
export function renderCVText(cv: StructuredCV, job: ParsedJob): string {
  return renderCV(cv, sanitizeParsedJob(job).language);
}

/** Rendu texte d'un CV structuré, dans une langue donnée. */
export function renderCV(cv: StructuredCV, language: "FR" | "EN"): string {
  const safeCv = sanitizeStructuredCV(cv);
  const fr = language === "FR"; const l: string[] = [];
  if (safeCv.name) l.push(safeCv.name);
  if (safeCv.targetTitle) l.push(safeCv.targetTitle);
  l.push("");
  if (safeCv.summary) { l.push(fr ? "RESUME PROFESSIONNEL" : "PROFESSIONAL SUMMARY"); l.push(safeCv.summary, ""); }
  l.push(fr ? "EXPERIENCE PROFESSIONNELLE" : "EXPERIENCE", "");
  for (const exp of safeCv.experiences) {
    const ct = exp.contractType ? ` (${exp.contractType})` : "";
    l.push(`${exp.title} | ${exp.company}${ct}`); l.push(exp.dates);
    for (const b of exp.bullets) l.push(`- ${b}`);
    l.push("");
  }
  if (safeCv.skills.length) { l.push(`${fr ? "COMPETENCES" : "SKILLS"}: ${safeCv.skills.join(" | ")}`); l.push(""); }
  if (safeCv.formations.length) { l.push(fr ? "FORMATION" : "EDUCATION"); for (const f of safeCv.formations) l.push(`${f.degree} - ${f.school}${f.year ? ` (${f.year})` : ""}`); l.push(""); }
  if (safeCv.languages.length) { l.push(fr ? "LANGUES" : "LANGUAGES"); for (const la of safeCv.languages) l.push(`${la.name}${la.level ? ` - ${la.level}` : ""}`); }
  return l.join("\n").trim();
}

/** Annule une retouche : la phrase d'origine de l'utilisateur reprend sa place. */
export function revertRewrite(cv: StructuredCV, index: number): StructuredCV {
  const next = cloneStructuredCV(cv);
  const rw = next.rewrites?.[index];
  if (!rw || rw.reverted) return next;
  if (rw.target === "summary") {
    next.summary = rw.original;
  } else if (rw.experienceIndex !== undefined && rw.bulletIndex !== undefined) {
    const bullets = next.experiences[rw.experienceIndex]?.bullets;
    if (bullets && bullets[rw.bulletIndex] === rw.rewritten) bullets[rw.bulletIndex] = rw.original;
  }
  rw.reverted = true;
  return next;
}

// ── Report ──
export type PrimaryDiagnosis =
  | "Bon alignement global"
  | "Mismatch de metier"
  | "Competences metier critiques absentes"
  | "Experience proche mais preuves trop faibles"
  | "Bibliotheque insuffisamment detaillee"
  | "Niveau de poste trop junior"
  | "Niveau de poste trop senior";

export type RecruiterCredibility = "forte" | "correcte" | "fragile" | "faible";

export type DiagnosisCause =
  | "job_parsing_issue"
  | "library_too_thin"
  | "bullets_too_generic"
  | "mission_context_too_weak"
  | "evidence_vs_ats_gap"
  | "scoring_calibration_gap"
  | "proof_gap"
  | "cv_not_credible"
  | "adjacent_role"
  | "level_mismatch"
  | "strong_fit";

export interface DiagnosticSummary {
  primaryDiagnosis: PrimaryDiagnosis;
  verdict: string;
  whatMatches: string[];
  whatMissing: string[];
  nextActions: string[];
  primaryCause: DiagnosisCause;
  secondaryCauses: DiagnosisCause[];
  recommendedAction: string;
}

export type BadgeLevel = "probant" | "a_renforcer" | "fragile";

export type GeneratedCvFitNiveau = "coherent" | "trop_junior" | "trop_senior" | "uncertain";
export type HardWarningCode =
  | "junior_scope_mismatch"
  | "lead_scope_underproven"
  | "pm_scope_underproven"
  | "niche_domain_underproven"
  | "text_integrity_issue"
  | "concept_factory_mismatch"
  | "scope_too_simple"
  | "scope_support_fragmented";

export interface GeneratedCvAssessment {
  pertinence: number;
  fitMetier: number;
  fitNiveau: GeneratedCvFitNiveau;
  forcePreuve: number;
  credibiliteCv: number;
  evidenceGrounding: number;
  recruiterCredibilityScore: number;
  atsReadiness: number;
  overstatementRisk: number;
  distanceDomain: DistanceDomain;
  verdict: string;
  primaryDiagnosis: PrimaryDiagnosis;
  whatMatches: string[];
  whatMissing: string[];
  nextActions: string[];
  primaryCause: DiagnosisCause;
  secondaryCauses: DiagnosisCause[];
  hardWarnings: HardWarningCode[];
}

export interface GeneratedCvPairEvaluation {
  faithful: GeneratedCvAssessment;
  optimized?: GeneratedCvAssessment;
  notes: string[];
  scoreModel: "generated_cv_v1" | "legacy_fallback";
}

export interface OptimizationReport { cvLanguage?: "FR" | "EN"; jobLanguage?: "FR" | "EN"; structuredCV?: StructuredCV; rewrites?: CvRewrite[]; jobTitle: string; jobCompany: string; jobSeniority: string; jobDomain: string; detectedKeywords: { requiredSkills: string[]; preferredSkills: string[]; responsibilities: string[]; keywords: string[]; criticalKeywords: string[]; }; matchedSkills: string[]; missingSkills: string[]; selectedExperiences: { title: string; company: string; score: number; reason: string; matchedAspects: string[]; bulletCount: number; charBudget: number; }[]; rejectedExperiences: { title: string; company: string; score: number; reason: string }[]; selectedBullets: { text: string; experienceTitle: string; score: number; deterministicScore: number; llmScore: number; matchedKeywords: string[]; dimension: string; }[]; postRules: PostRuleResult; confidence: number; confidenceReasoning: string; fallbackUsed: boolean; detectedLanguage: "EN" | "FR"; positioning: string; intentions: string[]; productMaturity: string; complexityLevel: string; ownershipLevel: string; tips: string[]; diagnosis: DiagnosticSummary; scoreBreakdown: { fitOffer: number; ats: number; atsOptimized: number; atsBoost: number; contextSupport: number; semantic: number; recruiterCredibility: RecruiterCredibility; domainMismatch?: string; cappedByKeywords: boolean; cappedByEvidence: boolean; pertinence: number; fitMetier: number; fitNiveauFactor: number; fitNiveau?: GeneratedCvFitNiveau; forcePreuve: number; credibiliteCv: number; evidenceGrounding: number; recruiterCredibilityScore: number; atsReadiness: number; overstatementRisk: number; badge: BadgeLevel; distanceDomain: DistanceDomain; hardWarnings?: HardWarningCode[]; textIntegrityScore?: number; optimizationDecision?: "faithful_only" | "optimized_selected" | "optimized_rejected"; optimizationNotes?: string[]; variantStrategy?: "faithful" | "optimized_humain"; scoreModel?: "generated_cv_v1" | "legacy_fallback" | "profile_frame_v3"; debugOverlaps?: { workObjects: number; deliverables: number; decisions: number }; }; }

function topItems(items: string[], count: number): string[] {
  const tally = new Map<string, number>();
  for (const item of items.filter(Boolean)) tally.set(item, (tally.get(item) || 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, count).map(([item]) => item);
}

function joinNatural(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} et ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}

function collectMissionContextSupport(selExps: ScoredExperience[], criticalKeywords: string[], directKeywords: string[]): { contextKeywords: string[]; contextOnlyKeywords: string[] } {
  const descText = selExps.map(se => se.experience.description || "").join(" ").toLowerCase();
  if (!descText.trim() || criticalKeywords.length === 0) return { contextKeywords: [], contextOnlyKeywords: [] };
  const contextKeywords = criticalKeywords.filter(kw => textHasKeyword(descText, kw));
  const contextOnlyKeywords = contextKeywords.filter(kw => !directKeywords.some(direct => normalizeEvidenceText(direct) === normalizeEvidenceText(kw)));
  return { contextKeywords, contextOnlyKeywords };
}

function getEvidenceProgressiveCap(
  evidenceScore: number,
  criticalKeywordCount: number,
  semanticScore: number = 0,
  hasDomainMismatch: boolean = false
): number {
  if (criticalKeywordCount < 4) return 100;
  // Same-domain + LLM confirms semantic relevance → relaxed caps
  const sameDomainHighSemantic = !hasDomainMismatch && semanticScore >= 55;
  if (sameDomainHighSemantic) {
    if (evidenceScore <= 10) return 52;
    if (evidenceScore <= 20) return 62;
    if (evidenceScore < 25) return 67;
    if (evidenceScore < 35) return 74;
    if (evidenceScore < 45) return 82;
    return 100;
  }
  // Strict caps for cross-domain or low semantic
  if (evidenceScore <= 10) return 28;
  if (evidenceScore <= 20) return 36;
  if (evidenceScore < 25) return 40;
  if (evidenceScore < 35) return 48;
  if (evidenceScore < 45) return 58;
  return 100;
}

function getAtsGapCap(
  atsBoost: number,
  fitBase: number,
  evidenceScore: number,
  sameDomainHighSemantic: boolean = false
): number {
  if (atsBoost < 15 || fitBase >= 55) return 100;
  if (sameDomainHighSemantic) {
    if (atsBoost >= 35 && evidenceScore < 25) return 65;
    if (atsBoost >= 25 && evidenceScore < 35) return 72;
    if (atsBoost >= 20 && evidenceScore < 45) return 80;
    return 100;
  }
  if (atsBoost >= 35 && evidenceScore < 25) return 45;
  if (atsBoost >= 25 && evidenceScore < 35) return 52;
  if (atsBoost >= 20 && evidenceScore < 45) return 60;
  return 100;
}

function getRecruiterCredibility(params: {
  fitOffer: number;
  evidenceScore: number;
  semanticScore: number;
  domainMismatch?: string;
  evidenceGapIsHigh: boolean;
  libraryLooksThin: boolean;
  evidenceIsWeak: boolean;
}): RecruiterCredibility {
  const { fitOffer, evidenceScore, semanticScore, domainMismatch, evidenceGapIsHigh, libraryLooksThin, evidenceIsWeak } = params;
  if (domainMismatch || fitOffer < 35 || (evidenceGapIsHigh && evidenceScore < 35)) return "faible";
  if (fitOffer < 50 || libraryLooksThin || evidenceIsWeak || evidenceGapIsHigh) return "fragile";
  if (fitOffer < 70 || semanticScore < 70) return "correcte";
  return "forte";
}

function inferProfileSeniority(allExps: Experience[]): "junior" | "mid" | "senior" {
  if (allExps.length === 0) return "junior";
  const totalYears = allExps.reduce((sum, exp) => {
    const start = exp.startDate ? new Date(exp.startDate).getTime() : Date.now();
    const end = exp.endDate ? new Date(exp.endDate).getTime() : Date.now();
    return sum + Math.max(0, (end - start) / (365.25 * 24 * 3600 * 1000));
  }, 0);
  if (totalYears < 2) return "junior";
  if (totalYears < 5) return "mid";
  return "senior";
}

function detectSeniorityMismatch(jobSeniority: string, allExps: Experience[]): "over-qualified" | "under-qualified" | undefined {
  const profileLevel = inferProfileSeniority(allExps);
  const jobLevel = jobSeniority?.toLowerCase();
  // Profil senior appliquant pour un stage ou junior
  if ((jobLevel === "junior" || jobLevel === "stage" || jobLevel === "intern") && profileLevel === "senior") {
    return "over-qualified";
  }
  // Profil junior appliquant pour senior/lead/director
  if ((jobLevel === "senior" || jobLevel === "lead" || jobLevel === "director") && profileLevel === "junior") {
    return "under-qualified";
  }
  return undefined;
}

function rankDiagnosisCauses(params: {
  job: ParsedJob;
  selExps: ScoredExperience[];
  fitOffer: number;
  legacyConfidence: number;
  evidenceScore: number;
  atsOptimized: number;
  atsBoost: number;
  semanticScore: number;
  contextSupport: number;
  libraryLooksThin: boolean;
  evidenceIsWeak: boolean;
  domainMismatch?: string;
}): DiagnosisCause[] {
  const { job, selExps, fitOffer, legacyConfidence, evidenceScore, atsOptimized, atsBoost, semanticScore, contextSupport, libraryLooksThin, evidenceIsWeak, domainMismatch } = params;
  const ranked: DiagnosisCause[] = [];
  const roleFrameItems = [
    ...job.roleFrame.workObjects,
    ...job.roleFrame.deliverables,
    ...job.roleFrame.decisions,
    ...job.roleFrame.collaborators,
    ...job.roleFrame.environments,
  ].filter(Boolean);
  const genericSignals = ["communication", "collaboration", "management", "strategie", "strategy", "business", "digital", "transformation", "project", "process", "operations", "delivery"];
  const genericRoleFrameCount = roleFrameItems.filter(item => {
    const normalized = normalizeEvidenceText(item);
    return genericSignals.some(signal => normalized.includes(signal));
  }).length;
  const parsingLooksWeak = (job.responsibilities.length >= 4 && roleFrameItems.length < 4)
    || (roleFrameItems.length > 0 && genericRoleFrameCount >= Math.ceil(roleFrameItems.length * 0.7))
    || job.criticalKeywords.some(keyword => normalizeEvidenceText(keyword).split(" ").length > 4);
  const descriptionsPresent = selExps.filter(se => normalizeEvidenceText(se.experience.description || "").split(" ").filter(Boolean).length >= 6).length;
  const missionContextTooWeak = descriptionsPresent >= 2 && contextSupport === 0 && evidenceScore < 45;
  const evidenceVsAtsGap = atsOptimized >= 70 && fitOffer < 45 && atsBoost >= 20;
  const bulletsTooGeneric = !libraryLooksThin && !domainMismatch && semanticScore >= 55 && evidenceScore < 45;
  const calibrationGap = Math.abs(legacyConfidence - fitOffer) >= 18;

  if (evidenceVsAtsGap) ranked.push("evidence_vs_ats_gap");
  if (libraryLooksThin) ranked.push("library_too_thin");
  if (bulletsTooGeneric || evidenceIsWeak) ranked.push("bullets_too_generic");
  if (missionContextTooWeak) ranked.push("mission_context_too_weak");
  if (parsingLooksWeak) ranked.push("job_parsing_issue");
  if (calibrationGap) ranked.push("scoring_calibration_gap");
  return uniqueItems(ranked) as DiagnosisCause[];
}

function recommendedActionForCause(cause: DiagnosisCause, fallback: string): string {
  switch (cause) {
    case "job_parsing_issue":
      return "Verifie l'annonce brute: si les mots-cles ou le role reel sont bruites, relance avec un texte plus propre ou corrige la source.";
    case "library_too_thin":
      return "Enrichis 1 ou 2 experiences proches avec 3 a 5 bullets concrets avant de retenter le tailoring.";
    case "bullets_too_generic":
      return "Rends 2 ou 3 bullets plus probants avec objets metier, scope, decisions et impact concret.";
    case "mission_context_too_weak":
      return "Reecris le contexte mission avec plus d'objets, livrables et contraintes pour aider le moteur sans surpromettre.";
    case "evidence_vs_ats_gap":
      return "Considere le CV comme ATS-compatible mais encore peu credible: ajoute des preuves reellement ancrees avant d'augmenter le score.";
    case "scoring_calibration_gap":
      return "Compare le fit offre et l'ATS plutot que le score legacy: si l'ecart persiste, il faut recalibrer le moteur plutot que le CV.";
    case "proof_gap":
      return "Le metier colle, mais les preuves visibles dans tes bullets restent trop faibles pour convaincre.";
    case "cv_not_credible":
      return "Le profil est pertinent, mais le CV genere n'est pas encore assez credible pour etre envoye tel quel.";
    case "adjacent_role":
      return "Le role est adjacent a ton coeur de metier: la transition est possible, mais pas naturelle.";
    case "level_mismatch":
      return "Le niveau du poste est incoherent avec la trajectoire actuelle de ton profil.";
    case "strong_fit":
      return "Le profil et le role sont bien alignes.";
    default:
      return fallback;
  }
}

const PRIMARY_DIAGNOSIS_VALUES: PrimaryDiagnosis[] = [
  "Bon alignement global",
  "Mismatch de metier",
  "Competences metier critiques absentes",
  "Experience proche mais preuves trop faibles",
  "Bibliotheque insuffisamment detaillee",
  "Niveau de poste trop junior",
  "Niveau de poste trop senior",
];

const DIAGNOSIS_CAUSE_VALUES: DiagnosisCause[] = [
  "job_parsing_issue",
  "library_too_thin",
  "bullets_too_generic",
  "mission_context_too_weak",
  "evidence_vs_ats_gap",
  "scoring_calibration_gap",
  "proof_gap",
  "cv_not_credible",
  "adjacent_role",
  "level_mismatch",
  "strong_fit",
];

const GENERATED_CV_FIT_LEVEL_VALUES: GeneratedCvFitNiveau[] = [
  "coherent",
  "trop_junior",
  "trop_senior",
  "uncertain",
];

function clampPercent(value: any, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function takeTextList(value: any, max = 3): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item || "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function coercePrimaryDiagnosis(value: any, fallback: PrimaryDiagnosis): PrimaryDiagnosis {
  return PRIMARY_DIAGNOSIS_VALUES.includes(value as PrimaryDiagnosis)
    ? value as PrimaryDiagnosis
    : fallback;
}

function coerceDiagnosisCause(value: any, fallback: DiagnosisCause): DiagnosisCause {
  return DIAGNOSIS_CAUSE_VALUES.includes(value as DiagnosisCause)
    ? value as DiagnosisCause
    : fallback;
}

function coerceGeneratedCvFitNiveau(value: any, fallback: GeneratedCvFitNiveau = "uncertain"): GeneratedCvFitNiveau {
  return GENERATED_CV_FIT_LEVEL_VALUES.includes(value as GeneratedCvFitNiveau)
    ? value as GeneratedCvFitNiveau
    : fallback;
}

function generatedCvFitNiveauFactor(level: GeneratedCvFitNiveau): number {
  switch (level) {
    case "coherent":
      return 1;
    case "trop_junior":
      return 0.4;
    case "trop_senior":
      return 0.55;
    default:
      return 0.85;
  }
}

const LEAD_SCOPE_EVIDENCE_GROUPS: string[][] = [
  ["lead ux", "lead designer", "leadership", "lead"],
  ["alignement des equipes", "alignment", "vision commune", "vision produit", "design strategy", "strategie design"],
  ["mentorat", "mentor", "coaching", "coach"],
  ["rituels", "weekly", "design review", "review", "critique", "atelier"],
  ["guidelines", "standards ux", "bonnes pratiques", "structuration", "design ops", "practices"],
];

const PEOPLE_MANAGEMENT_EVIDENCE_GROUPS: string[][] = [
  ["people management", "management d equipe", "team management", "manage designers", "manager"],
  ["faire grandir une equipe", "grow a team", "team of designers", "equipe de designers"],
  ["hiring", "recrutement", "recruter"],
];

const PRODUCT_MANAGEMENT_EVIDENCE_GROUPS: string[][] = [
  ["product management", "product manager", "product owner"],
  ["roadmap", "priorisation", "prioritization", "backlog", "user stories", "sprint planning"],
  ["kpi", "metrics", "metric", "success criteria", "product discovery"],
];

function buildReportEvidenceCorpus(report: OptimizationReport): string {
  return [
    ...report.selectedBullets.map(b => `${b.experienceTitle} ${b.text} ${b.matchedKeywords.join(" ")}`),
    ...report.selectedExperiences.flatMap(exp => [exp.title, ...exp.matchedAspects]),
  ].join(" ");
}

function countPatternGroups(text: string, groups: string[][]): number {
  return groups.filter(group => group.some(pattern => textHasKeyword(text, pattern))).length;
}

function requiresLeadScope(report: OptimizationReport): boolean {
  return report.positioning === "lead" || /\b(lead|head|director|directeur)\b/i.test(report.jobTitle);
}

function requiresPeopleManagement(report: OptimizationReport): boolean {
  const jobSignals = normalizeEvidenceText([
    report.jobTitle,
    report.jobSeniority,
    ...(report.detectedKeywords.requiredSkills || []),
    ...(report.detectedKeywords.responsibilities || []),
  ].join(" "));
  return /\b(team management|people management|management d equipe|grow a team|faire grandir une equipe|manage designers|manager)\b/.test(jobSignals);
}

function requiresProductManagementScope(report: OptimizationReport): boolean {
  const title = normalizeEvidenceText(report.jobTitle);
  const signals = normalizeEvidenceText([
    report.jobTitle,
    ...(report.detectedKeywords.requiredSkills || []),
    ...(report.detectedKeywords.responsibilities || []),
  ].join(" "));
  return /\b(product manager|product owner|chef de produit)\b/.test(title)
    || /\b(product management|backlog|roadmap|prioritization|priorisation|user stories)\b/.test(signals);
}

function applyAssessmentGuardrails(report: OptimizationReport, assessment: GeneratedCvAssessment): GeneratedCvAssessment {
  const adjusted: GeneratedCvAssessment = {
    ...assessment,
    whatMatches: [...assessment.whatMatches],
    whatMissing: [...assessment.whatMissing],
    nextActions: [...assessment.nextActions],
    secondaryCauses: [...assessment.secondaryCauses],
    hardWarnings: [...(assessment.hardWarnings || [])],
  };
  const evidenceCorpus = buildReportEvidenceCorpus(report);
  // Only check title + parsed seniority — NOT responsibilities (which can mention "junior" in mentoring context,
  // e.g. "mentor junior designers", creating a false positive for any senior-hiring role with mentoring duties)
  const senioritySignals = normalizeEvidenceText([
    report.jobTitle,
    report.jobSeniority,
  ].join(" "));
  const selectedScopeSignals = normalizeEvidenceText([
    ...report.selectedExperiences.map(exp => exp.title),
    ...report.selectedBullets.map(bullet => bullet.experienceTitle),
    evidenceCorpus,
  ].join(" "));
  const juniorLikeRole = /\b(junior|stage|intern|internship|alternance|apprentice|entry.?level)\b/.test(senioritySignals);
  const clearlySeniorProfile = /\b(senior|lead|head|staff|principal|manager|director)\b/.test(selectedScopeSignals);

  if (juniorLikeRole && clearlySeniorProfile) {
    adjusted.fitMetier = Math.min(adjusted.fitMetier, 72);
    adjusted.recruiterCredibilityScore = Math.min(adjusted.recruiterCredibilityScore, 58);
    adjusted.credibiliteCv = adjusted.recruiterCredibilityScore;
    adjusted.overstatementRisk = Math.max(adjusted.overstatementRisk, 72);
    adjusted.fitNiveau = "trop_junior";
  }

  // Safety net: if the LLM evaluator said "trop_junior" but the role is NOT actually junior/stage/intern
  // (e.g. a "mid"-labeled role that still requires 5+ years), downgrade to "uncertain" to avoid a -18/ceiling-62 cliff.
  // "trop_junior" penalty is reserved for roles that explicitly target juniors/interns/apprentices.
  if (adjusted.fitNiveau === "trop_junior" && !juniorLikeRole) {
    adjusted.fitNiveau = "uncertain";
  }

  // Lead-scope thin : plus de clamp chiffré ici. Le warning `lead_scope_underproven`
  // reste émis par buildHardWarnings si l'évaluateur juge le niveau incertain,
  // mais on ne force plus fitNiveau/credibilité à la baisse sur simple regex.
  if (requiresLeadScope(report)) {
    const leadGroups = countPatternGroups(evidenceCorpus, LEAD_SCOPE_EVIDENCE_GROUPS);
    const managementGroups = countPatternGroups(evidenceCorpus, PEOPLE_MANAGEMENT_EVIDENCE_GROUPS);
    const leadScopeThin = requiresPeopleManagement(report)
      ? leadGroups < 3 || managementGroups < 1
      : leadGroups < 2;
    if (leadScopeThin && requiresPeopleManagement(report) && adjusted.fitNiveau === "coherent") {
      // Cas le plus risqué (people management explicitement exigé, zéro preuve) :
      // on marque juste l'incertitude, sans toucher les scores.
      adjusted.fitNiveau = "uncertain";
    }
  }

  if (requiresProductManagementScope(report)) {
    const pmGroups = countPatternGroups(evidenceCorpus, PRODUCT_MANAGEMENT_EVIDENCE_GROUPS);
    if (pmGroups < 2) {
      adjusted.fitMetier = Math.min(adjusted.fitMetier, 35);
      adjusted.distanceDomain = "different";
      adjusted.recruiterCredibilityScore = Math.min(adjusted.recruiterCredibilityScore, 52);
      adjusted.credibiliteCv = adjusted.recruiterCredibilityScore;
      adjusted.overstatementRisk = Math.max(adjusted.overstatementRisk, 78);
      if (adjusted.fitNiveau === "coherent") adjusted.fitNiveau = "uncertain";
    }
  }

  // Les anciens clamps fins (missing evidence, niche, concept factory, scope
  // simple, support ownership) sont supprimés : leurs warnings restent émis
  // par buildHardWarnings pour l'UI, mais le score est jugé par l'évaluateur.

  return adjusted;
}

function recruiterCredibilityFromScore(score: number): RecruiterCredibility {
  if (score >= 75) return "forte";
  if (score >= 60) return "correcte";
  if (score >= 40) return "fragile";
  return "faible";
}

function fitNiveauLegitimacyScore(level: GeneratedCvFitNiveau): number {
  switch (level) {
    case "coherent":
      return 100;
    case "uncertain":
      return 70;
    case "trop_senior":
      return 30;
    case "trop_junior":
      return 18;
    default:
      return 60;
  }
}

function capPertinenceByDistance(score: number, distanceDomain: DistanceDomain): number {
  if (distanceDomain === "different") return Math.min(score, 25);
  if (distanceDomain === "adjacent") return Math.min(score, 72);
  return score;
}

function overstatementPenalty(params: {
  overstatementRisk: number;
  atsReadiness: number;
  evidenceGrounding: number;
}): number {
  const { overstatementRisk, atsReadiness, evidenceGrounding } = params;
  let penalty = overstatementRisk * 0.14;
  if (overstatementRisk >= 45) penalty += 4;
  if (overstatementRisk >= 60) penalty += 7;
  if (overstatementRisk >= 80) penalty += 8;
  if (atsReadiness >= 85 && evidenceGrounding < 70 && overstatementRisk >= 45) penalty += 6;
  return penalty;
}

function inferNicheDomainRequirement(report: OptimizationReport): boolean {
  const text = normalizeEvidenceText([
    report.jobTitle,
    report.jobDomain,
    ...(report.detectedKeywords.requiredSkills || []),
    ...(report.detectedKeywords.responsibilities || []),
    ...(report.detectedKeywords.criticalKeywords || []),
  ].join(" "));

  return /\b(football|gaming|game|policy|policies|compliance|cyber|security|data products|data visualization|visualisation|analytics)\b/.test(text);
}

function textIntegrityScore(text: string): number {
  const penalty = mojibakePenaltyScore(text);
  return clampPercent(100 - penalty * 14, 100);
}

function buildAssessmentTextIntegrityCorpus(report: OptimizationReport, renderedCvText?: string, jobText?: string): string {
  return [
    renderedCvText || "",
    jobText || "",
    report.confidenceReasoning || "",
    report.jobTitle,
    ...report.selectedBullets.map(bullet => bullet.text),
    ...report.selectedExperiences.map(exp => `${exp.title} ${exp.reason} ${(exp.matchedAspects || []).join(" ")}`),
  ].join("\n");
}

function hasComplexSystemEvidence(bullets: OptimizationReport["selectedBullets"]): boolean {
  const complexPatterns = [
    /\bB2B\b/i, /\bmulti[-\s]?(account|role|user|team|brand|marque)\b/i,
    /\bpermission\b/i, /\bworkflow\b/i, /\bentreprise\b/i, /\benterprise\b/i,
    /\badmin(istration)?\b/i, /\bdashboard\b/i, /\bop[eé]ration\b/i,
    /\bsyst[eè]me\b/i, /\bsystem\b/i, /\bplateforme\b/i, /\bplatform\b/i,
    /\bbackoffice\b/i, /\bback[-\s]office\b/i,
  ];
  const allText = bullets.map(b => b.text).join(" ");
  return complexPatterns.filter(p => p.test(allText)).length >= 2;
}

function hasRealProductEvidence(bullets: OptimizationReport["selectedBullets"], evidenceGrounding: number): boolean {
  if (evidenceGrounding >= 80) return true;
  const realPatterns = [
    /\d+\s*[%kKmM]\b/, /\bboutiques?\b/i, /\bconversion\b/i,
    /\bventes?\b/i, /\bperformance\b/i, /\bdeploy\b/i, /\bd[eé]ploie\b/i,
    /\bproduction\b/i, /\butilisateurs?\b/i, /\busers?\b/i,
    /\blive\b/i, /\bship\b/i, /\blivre\b/i,
  ];
  const allText = bullets.map(b => b.text).join(" ");
  return realPatterns.filter(p => p.test(allText)).length >= 2;
}

function buildHardWarnings(report: OptimizationReport, assessment: GeneratedCvAssessment, renderedCvText?: string, jobText?: string): HardWarningCode[] {
  const warnings: HardWarningCode[] = [];
  // Only check title + parsed seniority — NOT responsibilities (same false-positive risk as in applyAssessmentGuardrails)
  const senioritySignals = normalizeEvidenceText([
    report.jobTitle,
    report.jobSeniority,
  ].join(" "));
  const juniorLikeRole = /\b(junior|stage|intern|internship|alternance|apprentice|entry.?level)\b/.test(senioritySignals);
  const nicheUnderproven =
    inferNicheDomainRequirement(report)
    && assessment.distanceDomain === "same"
    && assessment.evidenceGrounding < 78
    && report.postRules.evidenceKeywordsMissing.length >= 2;
  const integrityScore = textIntegrityScore(buildAssessmentTextIntegrityCorpus(report, renderedCvText, jobText));

  if (juniorLikeRole && assessment.fitNiveau === "trop_junior") warnings.push("junior_scope_mismatch");
  if (requiresLeadScope(report) && assessment.fitNiveau === "uncertain") warnings.push("lead_scope_underproven");
  if (requiresProductManagementScope(report) && assessment.distanceDomain === "different") warnings.push("pm_scope_underproven");
  if (nicheUnderproven) warnings.push("niche_domain_underproven");
  if (integrityScore < 98) warnings.push("text_integrity_issue");

  // Concept factory: only warn if CV has real-product evidence AND domain matches
  // If domain is already "different", the mismatch is already captured — no need to pile on
  if (
    report.productMaturity === "concept_prototype" &&
    assessment.distanceDomain !== "different" &&
    hasRealProductEvidence(report.selectedBullets, assessment.evidenceGrounding)
  ) {
    warnings.push("concept_factory_mismatch");
  }

  // Scope too simple: only warn if CV shows complex-system evidence AND domain matches
  // If domain is already "different", the mismatch is already captured — no need to pile on
  if (
    report.complexityLevel === "simple_tools" &&
    assessment.distanceDomain !== "different" &&
    hasComplexSystemEvidence(report.selectedBullets)
  ) {
    warnings.push("scope_too_simple");
  }

  // Support-only scope: only warn if CV shows ownership/lead evidence AND domain matches
  // If domain is already "different", the mismatch is already captured — no need to pile on
  const evidenceCorpusLocal = buildReportEvidenceCorpus(report);
  if (
    report.ownershipLevel === "support" &&
    assessment.distanceDomain !== "different" &&
    countPatternGroups(evidenceCorpusLocal, LEAD_SCOPE_EVIDENCE_GROUPS) >= 2
  ) {
    warnings.push("scope_support_fragmented");
  }

  return uniqueItems(warnings) as HardWarningCode[];
}

function capPertinenceByWarnings(score: number, warnings: HardWarningCode[]): number {
  // 3 caps durs seulement : mismatch junior/stage, scope PM absent (mismatch de
  // métier réel), intégrité texte. Les autres warnings restent visibles dans
  // l'UI mais ne créent plus de falaises de score — c'est l'évaluateur LLM qui
  // module via fitMetier / grounding / overstatementRisk.
  let capped = score;
  if (warnings.includes("junior_scope_mismatch")) capped = Math.min(capped, 38);
  if (warnings.includes("pm_scope_underproven")) capped = Math.min(capped, 25);
  if (warnings.includes("text_integrity_issue")) capped = Math.min(capped, 58);
  return capped;
}

function computeGeneratedPertinence(assessment: GeneratedCvAssessment): number {
  const scopeFitScore = fitNiveauLegitimacyScore(assessment.fitNiveau);
  const base =
    assessment.fitMetier * 0.34
    + scopeFitScore * 0.28
    + assessment.evidenceGrounding * 0.24
    + assessment.recruiterCredibilityScore * 0.14;

  let score = base - overstatementPenalty({
    overstatementRisk: assessment.overstatementRisk,
    atsReadiness: assessment.atsReadiness,
    evidenceGrounding: assessment.evidenceGrounding,
  });

  if (assessment.fitNiveau === "trop_junior") score -= 18;
  else if (assessment.fitNiveau === "trop_senior") score -= 12;
  else if (assessment.fitNiveau === "uncertain") score -= 4;

  if (assessment.distanceDomain === "adjacent" && assessment.recruiterCredibilityScore < 65 && assessment.evidenceGrounding < 60) {
    score -= 6;
  }

  // Un seul plafond structurel : niveau incohérent. Les anciens plafonds fins
  // (crédibilité+8, grounding+6, bandes 82/84/92) créaient des falaises
  // incalibrables — la conservativité vient de l'évaluateur + overstatementPenalty.
  if (assessment.fitNiveau !== "coherent") {
    score = Math.min(score, assessment.fitNiveau === "uncertain" ? 78 : 62);
  }

  return clampPercent(capPertinenceByDistance(score, assessment.distanceDomain));
}

function uniqueDiagnosisCauses(causes: DiagnosisCause[]): DiagnosisCause[] {
  return causes.filter((cause, index) => cause && causes.indexOf(cause) === index).slice(0, 3);
}

function defaultNextActionFromAssessment(assessment: GeneratedCvAssessment, primaryCause: DiagnosisCause): string {
  if (assessment.fitNiveau === "trop_junior") {
    return "Cible un poste un cran plus proche de ton niveau actuel, ou renforce des preuves d'autonomie et d'ownership avant d'envoyer.";
  }
  if (assessment.fitNiveau === "trop_senior") {
    return "Recadre la cible vers un scope plus senior, ou rends explicite pourquoi tu vises un poste plus operationnel.";
  }
  if (assessment.fitNiveau === "uncertain" && assessment.distanceDomain === "same") {
    return "Le metier parait proche, mais clarifie mieux le scope exact, l'ownership ou le leadership reel avant d'envoyer.";
  }
  if (assessment.distanceDomain === "different") {
    return "Ne l'envoie pas tel quel: cible un role plus proche, ou assume clairement une reorientation au lieu de surpromettre.";
  }
  if (assessment.distanceDomain === "adjacent") {
    return "Assume l'adjacence: garde les experiences transferables les plus solides et retire les formulations qui survendent le coeur de metier.";
  }

  return recommendedActionForCause(primaryCause, "Renforce le document genere avant d'envoyer.");
}

function finalizeGeneratedCvAssessment(assessment: GeneratedCvAssessment): GeneratedCvAssessment {
  const evidenceGrounding = clampPercent(assessment.evidenceGrounding ?? assessment.forcePreuve, assessment.forcePreuve);
  const recruiterCredibilityScore = clampPercent(assessment.recruiterCredibilityScore ?? assessment.credibiliteCv, assessment.credibiliteCv);
  const atsReadiness = clampPercent(assessment.atsReadiness, 50);
  const overstatementRisk = clampPercent(assessment.overstatementRisk, 40);
  const normalized: GeneratedCvAssessment = {
    ...assessment,
    evidenceGrounding,
    recruiterCredibilityScore,
    atsReadiness,
    overstatementRisk,
    forcePreuve: evidenceGrounding,
    credibiliteCv: recruiterCredibilityScore,
    hardWarnings: uniqueItems((assessment.hardWarnings || []).filter(Boolean)) as HardWarningCode[],
  };

  const pertinence = capPertinenceByWarnings(
    computeGeneratedPertinence(normalized),
    normalized.hardWarnings || [],
  );

  let primaryDiagnosis: PrimaryDiagnosis;
  let primaryCause: DiagnosisCause;
  let verdict: string;

  if (normalized.distanceDomain === "different") {
    primaryDiagnosis = "Mismatch de metier";
    primaryCause = "adjacent_role";
    verdict = "Le CV partage quelques mots ou methodes avec l'offre, mais le coeur du role reste different.";
  } else if (normalized.fitNiveau === "trop_junior") {
    primaryDiagnosis = "Niveau de poste trop junior";
    primaryCause = "level_mismatch";
    verdict = "Le document reste proche du poste, mais le niveau attendu semble plus junior que la trajectoire que raconte ton profil.";
  } else if (normalized.fitNiveau === "trop_senior") {
    primaryDiagnosis = "Niveau de poste trop senior";
    primaryCause = "level_mismatch";
    verdict = "Le document reste proche du poste, mais le role demande un niveau ou un scope plus senior que les preuves les plus visibles.";
  } else if (normalized.distanceDomain === "adjacent") {
    primaryDiagnosis = "Mismatch de metier";
    primaryCause = "adjacent_role";
    verdict = "Le role reste adjacent a ton coeur de metier: la transition parait possible, mais elle n'est pas naturelle a la lecture du document.";
  } else if ((normalized.hardWarnings || []).includes("concept_factory_mismatch")) {
    primaryDiagnosis = "Experience proche mais preuves trop faibles";
    primaryCause = "proof_gap";
    verdict = "Le role est exploratoire sans produit live ni contraintes reelles. Ton profil prouve un impact concret — ce perimetre l'efface.";
  } else if ((normalized.hardWarnings || []).includes("scope_too_simple")) {
    primaryDiagnosis = "Experience proche mais preuves trop faibles";
    primaryCause = "proof_gap";
    verdict = "Le metier colle, mais le scope du produit (outil simple / PME) reste en dessous de la complexite que ton profil prouve.";
  } else if ((normalized.hardWarnings || []).includes("scope_support_fragmented")) {
    primaryDiagnosis = "Experience proche mais preuves trop faibles";
    primaryCause = "level_mismatch";
    verdict = "Le metier parait proche, mais le role propose peu d'ownership reel. Ton profil montre plus que ce que ce scope permet.";
  } else if (normalized.fitNiveau === "uncertain" && normalized.fitMetier >= 70) {
    primaryDiagnosis = "Experience proche mais preuves trop faibles";
    primaryCause = "level_mismatch";
    verdict = "Le metier parait proche, mais le scope exact du poste reste encore peu prouve par le document.";
  } else if (
    normalized.fitMetier >= 78
    && recruiterCredibilityScore >= 80
    && evidenceGrounding >= 75
    && overstatementRisk <= 35
  ) {
    primaryDiagnosis = "Bon alignement global";
    primaryCause = "strong_fit";
    verdict = "Le document reste proche du role, credible pour un recruteur et bien ancre dans les preuves visibles de ton parcours.";
  } else if (normalized.fitMetier >= 60) {
    primaryDiagnosis = "Experience proche mais preuves trop faibles";
    primaryCause = overstatementRisk >= 60 ? "cv_not_credible" : "proof_gap";
    verdict = overstatementRisk >= 60
      ? "L'experience parait proche du poste, mais certaines formulations survendent encore ce que le profil prouve reellement."
      : "L'experience parait proche du poste, mais les preuves visibles restent encore trop faibles ou trop generales pour convaincre sereinement.";
  } else {
    primaryDiagnosis = "Competences metier critiques absentes";
    primaryCause = "proof_gap";
    verdict = "Le document ne montre pas encore assez de preuves directes sur les competences centrales demandees par ce poste.";
  }

  const secondaryCauses = uniqueDiagnosisCauses([
    normalized.distanceDomain !== "same" ? "adjacent_role" : undefined,
    normalized.fitNiveau !== "coherent" ? "level_mismatch" : undefined,
    overstatementRisk >= 60 ? "cv_not_credible" : undefined,
    evidenceGrounding < 60 ? "proof_gap" : undefined,
    atsReadiness >= 85 && evidenceGrounding < 55 && overstatementRisk >= 60 ? "evidence_vs_ats_gap" : undefined,
    primaryCause === "strong_fit" ? "strong_fit" : undefined,
  ].filter(Boolean) as DiagnosisCause[]);

  const whatMatches = uniqueItems([
    normalized.distanceDomain === "same" ? "Le coeur du role reste proche de tes experiences les plus visibles." : "",
    evidenceGrounding >= 65 ? "Les experiences retenues apportent des preuves concretes et relisibles." : "",
    atsReadiness >= 80 ? "Le document couvre les mots attendus sans dependre uniquement du titre." : "",
  ].filter(Boolean)).slice(0, 3);

  const whatMissing = uniqueItems([
    normalized.fitNiveau === "uncertain" && normalized.distanceDomain === "same"
      ? "Le scope du poste reste plus large ou plus structurant que ce que le document prouve aujourd'hui."
      : "",
    evidenceGrounding < 75 ? "Les preuves restent encore trop generales ou pas assez ancrees dans des objets metier precis." : "",
    overstatementRisk >= 60 ? "Certaines formulations paraissent plus fortes que ce que prouvent vraiment les bullets source." : "",
    normalized.distanceDomain === "adjacent" ? "Le coeur de metier de l'offre n'est pas encore naturellement porte par le document." : "",
    normalized.distanceDomain === "different" ? "Le document ne raconte pas encore le meme metier que l'offre ciblee." : "",
  ].filter(Boolean)).slice(0, 3);

  const nextActions = [defaultNextActionFromAssessment(normalized, primaryCause)];

  return {
    ...normalized,
    pertinence,
    verdict,
    primaryDiagnosis,
    primaryCause,
    secondaryCauses,
    whatMatches,
    whatMissing,
    nextActions,
  };
}

function badgeFromGeneratedAssessment(assessment: GeneratedCvAssessment): BadgeLevel {
  const warnings = assessment.hardWarnings || [];
  if (
    warnings.includes("text_integrity_issue")
    || warnings.includes("pm_scope_underproven")
    || warnings.includes("junior_scope_mismatch")
    || assessment.fitNiveau === "trop_junior"
  ) {
    return "fragile";
  }
  if (
    assessment.fitNiveau === "coherent"
    && assessment.pertinence >= 78
    && assessment.recruiterCredibilityScore >= 80
    && assessment.evidenceGrounding >= 75
    && assessment.overstatementRisk <= 35
    && assessment.distanceDomain === "same"
    && warnings.length === 0
  ) {
    return "probant";
  }
  if (
    assessment.overstatementRisk >= 60
    || assessment.recruiterCredibilityScore < 55
    || assessment.evidenceGrounding < 50
    || assessment.distanceDomain === "different"
    || assessment.fitNiveau === "trop_senior"
    || warnings.includes("lead_scope_underproven")
    || warnings.includes("niche_domain_underproven")
  ) {
    return assessment.pertinence >= 60 && assessment.fitNiveau === "trop_senior" ? "a_renforcer" : "fragile";
  }
  return "a_renforcer";
}

function assessmentFromLegacyReport(report: OptimizationReport): GeneratedCvAssessment {
  const legacyFit = clampPercent(report.scoreBreakdown.fitOffer ?? report.confidence, 0);
  const legacyProof = clampPercent(report.scoreBreakdown.ats, 0);
  const legacyCred =
    report.scoreBreakdown.recruiterCredibility === "forte" ? 82
    : report.scoreBreakdown.recruiterCredibility === "correcte" ? 66
    : report.scoreBreakdown.recruiterCredibility === "fragile" ? 46
    : 28;

  const fitNiveau: GeneratedCvFitNiveau =
    report.diagnosis.primaryDiagnosis === "Niveau de poste trop junior" ? "trop_junior"
    : report.diagnosis.primaryDiagnosis === "Niveau de poste trop senior" ? "trop_senior"
    : "coherent";

  const distanceDomain: DistanceDomain =
    report.scoreBreakdown.domainMismatch ? "different"
    : legacyFit >= 65 ? "same"
    : legacyFit >= 35 ? "adjacent"
    : "different";

  const atsReadiness = clampPercent(report.scoreBreakdown.atsOptimized ?? report.scoreBreakdown.ats, report.scoreBreakdown.ats);
  const overstatementRisk = clampPercent(
    (report.scoreBreakdown.atsBoost ?? 0) * 1.5
      + (report.scoreBreakdown.domainMismatch ? 25 : 0)
      + (legacyCred < 60 ? (60 - legacyCred) * 0.8 : 0)
      + (legacyProof < 55 ? (55 - legacyProof) * 0.35 : 0),
    35,
  );

  return finalizeGeneratedCvAssessment({
    pertinence: legacyFit,
    fitMetier: legacyFit,
    fitNiveau,
    forcePreuve: legacyProof,
    credibiliteCv: legacyCred,
    evidenceGrounding: legacyProof,
    recruiterCredibilityScore: legacyCred,
    atsReadiness,
    overstatementRisk,
    distanceDomain,
    verdict: report.diagnosis.verdict || report.confidenceReasoning,
    primaryDiagnosis: report.diagnosis.primaryDiagnosis,
    whatMatches: report.diagnosis.whatMatches.slice(0, 3),
    whatMissing: report.diagnosis.whatMissing.slice(0, 3),
    nextActions: report.diagnosis.nextActions.slice(0, 3),
    primaryCause: report.diagnosis.primaryCause,
    secondaryCauses: report.diagnosis.secondaryCauses.slice(0, 3),
    hardWarnings: report.scoreBreakdown.hardWarnings || [],
  });
}

function applyGeneratedCvAssessment(
  report: OptimizationReport,
  assessment: GeneratedCvAssessment,
  scoreModel: GeneratedCvPairEvaluation["scoreModel"],
  renderedCvText?: string,
  jobText?: string,
): OptimizationReport {
  const guarded = applyAssessmentGuardrails(report, assessment);
  const hardWarnings = buildHardWarnings(report, guarded, renderedCvText, jobText);
  const finalized = finalizeGeneratedCvAssessment({
    ...guarded,
    hardWarnings,
  });
  const rawBadge = badgeFromGeneratedAssessment(finalized);
  // V2 (legacy_fallback) safety cap: never award "probant" when the LLM evaluator
  // was unavailable. The heuristic mapping ("forte"->82) is approximate and cannot
  // ground-check the actual generated document the way V3 can.
  const badge: BadgeLevel = scoreModel === "legacy_fallback" && rawBadge === "probant"
    ? "a_renforcer"
    : rawBadge;
  const recruiterCredibility = recruiterCredibilityFromScore(finalized.recruiterCredibilityScore);
  const warningMessages = uniqueItems([
    hardWarnings.includes("junior_scope_mismatch")
      ? "Le poste vise un scope junior ou stage: ta candidature peut paraitre surdimensionnee malgre la proximite metier."
      : "",
    hardWarnings.includes("lead_scope_underproven")
      ? "Le coeur du role parait proche, mais le scope lead ou head reste encore peu prouve dans les experiences retenues."
      : "",
    hardWarnings.includes("pm_scope_underproven")
      ? "Le poste attend un vrai scope Product Management / CRM qui n'est pas assez ancre dans tes preuves actuelles."
      : "",
    hardWarnings.includes("niche_domain_underproven")
      ? "Le role est proche, mais le domaine reste specialise et les preuves specifiques restent encore partielles."
      : "",
    hardWarnings.includes("text_integrity_issue")
      ? "Le document final contient encore des artefacts d'encodage: il faut le corriger avant envoi."
      : "",
  ].filter(Boolean));
  const nextActions = uniqueItems([
    ...warningMessages.map(message =>
      message.includes("encodage")
        ? "Corrige le texte corrompu ou relance le run: un document avec artefacts d'encodage ne doit pas etre envoye."
        : message.includes("junior")
          ? "Attention au scope: ce poste parait trop junior ou stage par rapport a ton niveau actuel."
          : message.includes("Product Management")
            ? "Ne l'envoie pas comme role PM / CRM sans vraies preuves de priorisation, roadmap et ownership."
            : message.includes("scope lead")
              ? "Recadre le document sur un role senior IC ou clarifie mieux des preuves explicites de leadership reel."
              : "Renforce une ou deux preuves metier tres specifiques avant d'envoyer.",
    ),
    ...finalized.nextActions,
  ]).slice(0, 3);
  const whatMissing = uniqueItems([...warningMessages, ...finalized.whatMissing]).slice(0, 3);
  const recommendedAction = nextActions[0]
    || recommendedActionForCause(finalized.primaryCause, report.diagnosis.recommendedAction || "Renforce le document genere avant d'envoyer.");
  const integrityScore = textIntegrityScore(buildAssessmentTextIntegrityCorpus(report, renderedCvText, jobText));

  return {
    ...report,
    confidence: finalized.pertinence,
    confidenceReasoning: finalized.verdict || report.confidenceReasoning,
    diagnosis: {
      primaryDiagnosis: finalized.primaryDiagnosis,
      verdict: finalized.verdict || report.diagnosis.verdict,
      whatMatches: finalized.whatMatches,
      whatMissing,
      nextActions,
      primaryCause: finalized.primaryCause,
      secondaryCauses: finalized.secondaryCauses,
      recommendedAction,
    },
    scoreBreakdown: {
      ...report.scoreBreakdown,
      domainMismatch: finalized.distanceDomain === "different"
        ? (report.scoreBreakdown.domainMismatch || "distance-domain")
        : undefined,
      pertinence: finalized.pertinence,
      fitMetier: finalized.fitMetier,
      fitNiveauFactor: generatedCvFitNiveauFactor(finalized.fitNiveau),
      fitNiveau: finalized.fitNiveau,
      forcePreuve: finalized.forcePreuve,
      credibiliteCv: finalized.credibiliteCv,
      evidenceGrounding: finalized.evidenceGrounding,
      recruiterCredibilityScore: finalized.recruiterCredibilityScore,
      atsReadiness: finalized.atsReadiness,
      overstatementRisk: finalized.overstatementRisk,
      badge,
      distanceDomain: finalized.distanceDomain,
      hardWarnings,
      textIntegrityScore: integrityScore,
      recruiterCredibility,
      scoreModel,
    },
  };
}

function buildJobAssessmentSummary(job: ParsedJob): string {
  const responsibilities = job.responsibilities.slice(0, 8).map(item => `- ${item}`).join("\n");
  const criticalKeywords = job.criticalKeywords.slice(0, 12).join(", ");
  const intentions = job.intentions.slice(0, 6).join(", ");
  return [
    `Title: ${job.title || "n/a"}`,
    `Company: ${job.company || "n/a"}`,
    `Seniority: ${job.seniority || "n/a"}`,
    `Domain: ${job.domain || "n/a"}`,
    `Positioning: ${job.positioning || "n/a"}`,
    `Language: ${job.language || "n/a"}`,
    `Critical keywords: ${criticalKeywords || "n/a"}`,
    `Intentions: ${intentions || "n/a"}`,
    `Responsibilities:\n${responsibilities || "- n/a"}`,
  ].join("\n");
}

function buildSelectedEvidenceSummary(selExps: ScoredExperience[]): string {
  return selExps
    .filter(se => se.selectedBullets.length > 0)
    .slice(0, 8)
    .map(se => {
      const bullets = se.selectedBullets
        .slice(0, 5)
        .map(sb => `- ${sb.bullet.text}`)
        .join("\n");
      return `### ${se.experience.title} @ ${se.experience.company}\nReason: ${se.reason}\n${bullets}`;
    })
    .join("\n\n");
}

function normalizeGeneratedCvAssessment(raw: any, fallback: GeneratedCvAssessment): GeneratedCvAssessment {
  return {
    pertinence: clampPercent(raw?.pertinence, fallback.pertinence),
    fitMetier: clampPercent(raw?.fitMetier, fallback.fitMetier),
    fitNiveau: coerceGeneratedCvFitNiveau(raw?.fitNiveau, fallback.fitNiveau),
    forcePreuve: clampPercent(raw?.forcePreuve ?? raw?.evidenceGrounding, fallback.forcePreuve),
    credibiliteCv: clampPercent(raw?.credibiliteCv ?? raw?.recruiterCredibilityScore, fallback.credibiliteCv),
    evidenceGrounding: clampPercent(raw?.evidenceGrounding ?? raw?.forcePreuve, fallback.evidenceGrounding),
    recruiterCredibilityScore: clampPercent(raw?.recruiterCredibilityScore ?? raw?.credibiliteCv, fallback.recruiterCredibilityScore),
    atsReadiness: clampPercent(raw?.atsReadiness, fallback.atsReadiness),
    overstatementRisk: clampPercent(raw?.overstatementRisk, fallback.overstatementRisk),
    distanceDomain: ["same", "adjacent", "different"].includes(raw?.distanceDomain)
      ? raw.distanceDomain as DistanceDomain
      : fallback.distanceDomain,
    verdict: String(raw?.verdict || fallback.verdict || "").trim() || fallback.verdict,
    primaryDiagnosis: coercePrimaryDiagnosis(raw?.primaryDiagnosis, fallback.primaryDiagnosis),
    whatMatches: takeTextList(raw?.whatMatches, 3),
    whatMissing: takeTextList(raw?.whatMissing, 3),
    nextActions: takeTextList(raw?.nextActions, 3),
    primaryCause: coerceDiagnosisCause(raw?.primaryCause, fallback.primaryCause),
    secondaryCauses: Array.isArray(raw?.secondaryCauses)
      ? raw.secondaryCauses
          .map((cause: any) => coerceDiagnosisCause(cause, fallback.primaryCause))
          .filter((cause: DiagnosisCause, index: number, arr: DiagnosisCause[]) => arr.indexOf(cause) === index)
          .slice(0, 3)
      : fallback.secondaryCauses,
    hardWarnings: Array.isArray(raw?.hardWarnings)
      ? raw.hardWarnings.filter((warning: any): warning is HardWarningCode => typeof warning === "string")
      : (fallback.hardWarnings || []),
  };
}

// Les valeurs sont ensuite bornées et normalisées par normalizeGeneratedCvAssessment ;
// le schéma garantit seulement la forme (un objet par variante).
const ASSESSMENT_SHAPE = z.object({}).passthrough();
const EVALUATION_SCHEMA = z.object({
  faithful: ASSESSMENT_SHAPE,
  optimized: ASSESSMENT_SHAPE.nullable().optional(),
  notes: z.array(z.string()).optional(),
}).passthrough();

async function evaluateGeneratedCvVariants(params: {
  job: ParsedJob;
  faithfulSelExps: ScoredExperience[];
  faithfulCv: StructuredCV;
  faithfulFallback: GeneratedCvAssessment;
  optimizedSelExps?: ScoredExperience[];
  optimizedCv?: StructuredCV;
  optimizedFallback?: GeneratedCvAssessment;
  openai: OpenAI;
}): Promise<GeneratedCvPairEvaluation> {
  const { job, faithfulSelExps, faithfulCv, faithfulFallback, optimizedSelExps, optimizedCv, optimizedFallback, openai } = params;
  const faithfulSourceEvidence = buildSelectedEvidenceSummary(faithfulSelExps);
  const optimizedSourceEvidence = buildSelectedEvidenceSummary(optimizedSelExps || faithfulSelExps);
  const faithfulText = renderCVText(faithfulCv, job);
  const optimizedText = optimizedCv ? renderCVText(optimizedCv, job) : "";

  try {
    const parsed = await completeJson(openai, {
      model: EVAL_MODEL,
      temperature: 0,
      schema: EVALUATION_SCHEMA,
      messages: [
        {
          role: "system",
          content:
            "You are a strict hiring reviewer. Evaluate the ACTUAL generated CV document against the ACTUAL source evidence used to build it. The product's goal is practical triage: should this generated CV be considered worth sending for this job? Be conservative. Never reward keyword stuffing, inferred expertise, or unsupported rewording. Return JSON only.",
        },
        {
          role: "user",
          content: [
            "Evaluate these CV variants built from source evidence selected by the engine.",
            "",
            "Scoring rules:",
            "- pertinence (0-100): quick triage score. Should this generated CV be considered worth sending for this offer?",
            "- fitMetier (0-100): how close the REAL work proved by the source evidence is to the REAL work of the offer. Do not rely on job title alone.",
            "- fitNiveau: coherent | trop_junior | trop_senior | uncertain.",
            "- evidenceGrounding (0-100): strength and concreteness of the SOURCE bullets only. Final wording must not inflate this score.",
            "- recruiterCredibilityScore (0-100): would a human recruiter believe the generated CV for this role?",
            "- atsReadiness (0-100): how well the FINAL CV is likely to perform on ATS keyword matching without rewarding stuffing.",
            "- overstatementRisk (0-100): risk that the FINAL CV overstates expertise beyond the source evidence.",
            "- distanceDomain: same | adjacent | different.",
            "",
            "Important constraints:",
            "- If the optimized CV overstates unsupported expertise, lower recruiterCredibilityScore, evidenceGrounding and pertinence, and raise overstatementRisk.",
            "- A role can be 'designer' in title but still be different if the work objects are 3D/motion/brand/graphic and the source evidence is product design.",
            "- Judge the final document, but always anchor your judgment in the source evidence below.",
            "",
            "Return exactly these keys:",
            "{ faithful: { pertinence, fitMetier, fitNiveau, evidenceGrounding, recruiterCredibilityScore, atsReadiness, overstatementRisk, distanceDomain, verdict, primaryDiagnosis, whatMatches, whatMissing, nextActions, primaryCause, secondaryCauses }, optimized: {... or null}, notes: [] }",
            "",
            "Allowed primaryDiagnosis values:",
            PRIMARY_DIAGNOSIS_VALUES.join(" | "),
            "Allowed primaryCause values:",
            DIAGNOSIS_CAUSE_VALUES.join(" | "),
            "",
            "JOB",
            buildJobAssessmentSummary(job),
            "",
            "FAITHFUL SOURCE EVIDENCE USED BY THE ENGINE",
            faithfulSourceEvidence || "No selected evidence",
            "",
            "FAITHFUL CV",
            faithfulText,
            "",
            optimizedCv
              ? `OPTIMIZED SOURCE EVIDENCE USED BY THE ENGINE\n${optimizedSourceEvidence || "No selected evidence"}\n\nOPTIMIZED CV\n${optimizedText}`
              : "OPTIMIZED CV\nnull",
          ].join("\n"),
        },
      ],
    });

    const faithful = normalizeGeneratedCvAssessment(parsed.faithful, faithfulFallback);
    const optimized = optimizedCv
      ? normalizeGeneratedCvAssessment(parsed.optimized, optimizedFallback || faithfulFallback)
      : undefined;

    return {
      faithful,
      optimized,
      notes: takeTextList(parsed.notes, 4),
      scoreModel: "generated_cv_v1",
    };
  } catch (error: any) {
    log("evaluateGeneratedCvVariants FAILED", error?.message || String(error));
    return {
      faithful: faithfulFallback,
      optimized: optimizedCv ? (optimizedFallback || faithfulFallback) : undefined,
      notes: ["Fallback legacy: evaluation generated CV indisponible."],
      scoreModel: "legacy_fallback",
    };
  }
}

export function generateOptimizationReport(job: ParsedJob, selExps: ScoredExperience[], skills: Skill[], postRules: PostRuleResult, cv: StructuredCV): OptimizationReport {
  const allBullets = selExps.flatMap(se => se.selectedBullets);
  const total = allBullets.length;
  const allJobSkills = [...job.requiredSkills, ...job.preferredSkills].map(s => s.toLowerCase());
  const matched = skills.filter(s => allJobSkills.some(js => js.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(js)));
  const missingSkills = allJobSkills.filter(js => !skills.some(s => s.name.toLowerCase().includes(js) || js.includes(s.name.toLowerCase())));
  const avg = total > 0 ? Math.round(allBullets.reduce((s, b) => s + b.totalScore, 0) / total) : 0;
  const atsOptimized = job.criticalKeywords.length > 0 ? Math.round(postRules.keywordsCovered.length / job.criticalKeywords.length * 100) : 50;
  const atsEvidence = job.criticalKeywords.length > 0 ? Math.round(postRules.evidenceKeywordsCovered.length / job.criticalKeywords.length * 100) : 50;
  const atsBoost = Math.max(0, atsOptimized - atsEvidence);
  const missionContextSupport = collectMissionContextSupport(selExps, job.criticalKeywords, postRules.evidenceKeywordsCovered);
  const contextSupport = job.criticalKeywords.length > 0 ? Math.round(missionContextSupport.contextOnlyKeywords.length / job.criticalKeywords.length * 100) : 0;
  // Skills as partial evidence (0.5 weight): craft skills not in bullets but in the skills table count
  const coveredNorms = new Set(postRules.evidenceKeywordsCovered.map(normalizeEvidenceText));
  const skillNames = skills.map(s => normalizeEvidenceText(s.name));
  const skillEvidenceCount = job.criticalKeywords.filter(kw => {
    if (coveredNorms.has(normalizeEvidenceText(kw))) return false; // already counted as full evidence
    const kwNorm = normalizeEvidenceText(kw);
    return skillNames.some(sn => sn.length >= 3 && (sn.includes(kwNorm) || kwNorm.includes(sn)));
  }).length;
  // Semantic score from average bullet quality — computed first so caps can use it
  // (totalScore max = 60 det + 60 llm + 30 embeddings = 150)
  const semanticScore = Math.min(100, Math.round(avg * 100 / 150));

  // Role-family mismatch detection — must run BEFORE fitBase/fitOffer so caps are mismatch-aware
  const jobTitleLow = job.title.toLowerCase();
  const jobFullText = (jobTitleLow + " " + job.responsibilities.join(" ")).toLowerCase();
  const isPOJob = /\bproduct owner\b|\bpo\b|\bchef de produit\b|\bscrum master\b|\bproduct manager\b|\bpm\b/.test(jobTitleLow);
  const isDesignJob = /\bdesigner\b|\bux\b|\bui\b|\bdesign\b/.test(jobTitleLow);
  const isRetailSalesJob = /responsable.{0,5}magasin|responsable magasin|directeur.{0,5}magasin|chef de rayon|store manager|retail manager|sales floor|client portfolio|portefeuille client|objectifs de vente|sales target|clienteling|floor manager|vente boutique|coaching.{0,20}equipe de vente|equipe de vente|vendeur/i.test(jobFullText);
  const isPMJob = /chef de projet|project manager\b|programme manager|delivery manager|pilotage.{0,20}projet|jalons|livrables|moa\b|moe\b/.test(jobTitleLow);
  const isDataJob = /\bdata analyst\b|\bdata scientist\b|\bdata engineer\b|\bBI\b|power bi|tableau\b|machine learning|statistiques?\b/.test(jobTitleLow);
  const isDevJob = /\b(fullstack|full.?stack|developpeur|developer|front.?end|back.?end|software engineer|ingenieur.{0,10}logiciel|devops|sre)\b/i.test(jobTitleLow);
  const userIsDesigner = allBullets.some(b => /figma|maquett|prototype|design system|ux|ui|parcours|wireframe/i.test(b.bullet.text));
  const userIsPO = allBullets.some(b => /backlog|sprint|user stor|roadmap|priorisation|epic|okr/i.test(b.bullet.text));
  const userIsDev = allBullets.some(b => /\b(code|commit|deploy|api|endpoint|sql|git|pull request|refactor|unit test|ci.?cd)\b/i.test(b.bullet.text));
  const domainMismatch = isRetailSalesJob && userIsDesigner ? "retail-sales"
    : isDevJob && userIsDesigner && !userIsDev ? "development"
    : isPMJob && userIsDesigner && !userIsPO ? "project-management"
    : isDataJob && userIsDesigner ? "data-analytics"
    : isPOJob && userIsDesigner && !userIsPO ? "PO/PM vs Designer"
    : isDesignJob && userIsPO && !userIsDesigner ? "Designer vs PO"
    : undefined;

  // Seniority mismatch: profil senior sur poste junior, ou profil junior sur poste senior
  const seniorityMismatch = detectSeniorityMismatch(job.seniority, selExps.map(se => se.experience));

  // Skills evidence weight: higher for same-domain (craft skills ARE real proof when domain matches)
  const skillWeight = domainMismatch ? 0.3 : 0.75;
  // Les outils spécifiques (Hotjar, Mixpanel, Miro...) pèsent 0.5× au lieu de 1× — couverts ou non
  const toolKeywordWeight = (kw: string) => isSpecificToolKeyword(kw) ? 0.5 : 1;
  const coveredWeighted = postRules.evidenceKeywordsCovered.reduce((s, kw) => s + toolKeywordWeight(kw), 0);
  const denominatorWeighted = job.criticalKeywords.reduce((s, kw) => s + toolKeywordWeight(kw), 0);
  const weightedEvidenceCount = coveredWeighted + missionContextSupport.contextOnlyKeywords.length * 0.5 + skillEvidenceCount * skillWeight;
  const evidenceScore = denominatorWeighted > 0 ? Math.round(weightedEvidenceCount / denominatorWeighted * 100) : atsEvidence;
  const bulletBonus = total >= 6 ? Math.min(10, Math.round(evidenceScore * 0.1)) : Math.round(total * 1.5);
  const fitBase = Math.min(100, Math.round(semanticScore * 0.45 + evidenceScore * 0.45 + bulletBonus));
  const rawConfidence = Math.round(avg * 0.45 + evidenceScore * 0.45 + bulletBonus);
  // Hard cap: if less than 25% of critical keywords are present in the CV, it's a weak match regardless of bullet quality.
  // This catches cases where the profile domain is fundamentally different from the job (e.g. Designer → PO).
  const sameDomainHighSemantic = !domainMismatch && semanticScore >= 55;
  const critKwHardCap = getEvidenceProgressiveCap(evidenceScore, job.criticalKeywords.length, semanticScore, !!domainMismatch);
  const evidenceGapIsHigh = atsBoost >= 25 && evidenceScore <= 50;
  const evidenceGapHardCap = getAtsGapCap(atsBoost, fitBase, evidenceScore, sameDomainHighSemantic);
  const fitOffer = Math.min(critKwHardCap, evidenceGapHardCap, fitBase);
  const confidence = Math.min(critKwHardCap, evidenceGapHardCap, Math.min(100, rawConfidence));
  const tips: string[] = [];
  if (postRules.evidenceKeywordsMissing.length) tips.push(`Keywords critiques non prouvees dans la bibliotheque: ${postRules.evidenceKeywordsMissing.join(", ")}.`);
  if (missionContextSupport.contextOnlyKeywords.length > 0) tips.push(`Le contexte mission renforce ${joinNatural(missionContextSupport.contextOnlyKeywords.slice(0, 3))}, mais ces elements restent secondaires tant qu'ils ne sont pas explicites dans les bullets ou skills source.`);
  if (atsBoost > 0) tips.push(`Le CV final gagne ${atsBoost}% de couverture ATS via optimisation de texte, mais cela ne remplace pas une preuve metier dans les bullets ou skills source.`);
  if (postRules.bulletsWithNumbers < total * 0.3) tips.push("Moins de 30% de tes bullets contiennent des chiffres.");
  if (missingSkills.length > 3) tips.push(`${missingSkills.length} competences demandees absentes.`);
  if (job.positioning === "consultant" && !allBullets.some(b => /accompagn|structur|pratiqu|form|maturit|conseil/i.test(b.bullet.text))) {
    tips.push("Offre conseil : aucun bullet ne mentionne accompagnement ou structuration de pratiques.");
  }
  if (seniorityMismatch === "over-qualified") {
    tips.push("Ce poste est niveau junior/stage. Avec ton parcours, le recruteur s'attendra a un profil moins senior. Cible plutot des offres senior ou lead.");
  } else if (seniorityMismatch === "under-qualified") {
    tips.push("Ce poste demande un niveau senior ou lead. Renforce d'abord la preuve de ton impact et de ton scope avant de viser ce niveau.");
  }

  // Mismatch-specific tips (domainMismatch already set above)
  if (isPOJob && userIsDesigner && !userIsPO) {
    tips.push("Attention : ce poste est Product Owner/PM. Tes bullets sont orientes design. Le match est partiel, mais la gestion de backlog est absente.");
  }
  if (isDesignJob && userIsPO && !userIsDesigner) {
    tips.push("Attention : ce poste est Design mais tes bullets sont orientes Product/PO. Le match UX craft est limite.");
  }
  if (isRetailSalesJob && userIsDesigner) {
    tips.push("Ce poste est en gestion d'equipe retail / vente — pas en design produit. Le score faible est attendu et reflete la realite. Ce type de role necessite une experience de management terrain et de coaching commercial.");
  }
  if (isPMJob && userIsDesigner && !userIsPO) {
    tips.push("Ce poste est en pilotage de projet (IT/DSI). Ton profil est design. Les competences de structuration et d'alignement se transferent, mais la methodologie projet formelle est absente de ta bibliotheque.");
  }
  if (isDataJob && userIsDesigner) {
    tips.push("Ce poste est en data / analytics. Ton profil est design. L'approche data-driven peut se retrouver, mais les competences techniques (SQL, BI, stats) sont absentes de ta bibliotheque.");
  }
  if (isDevJob && userIsDesigner && !userIsDev) {
    tips.push("Ce poste est en developpement logiciel (fullstack/frontend/backend). Ton profil est design. Les competences ne se recoupent pas directement.");
  }
  const cappedByKeywords = critKwHardCap < 100 && rawConfidence > critKwHardCap;
  const cappedByEvidence = evidenceGapHardCap < 100 && rawConfidence > evidenceGapHardCap;
  const topMatchedAspects = topItems(selExps.flatMap(se => se.matchedAspects), 3);
  const supportedKeywordSet = new Set([...postRules.evidenceKeywordsCovered, ...missionContextSupport.contextKeywords].map(kw => kw.toLowerCase()));
  const topMissingKeywords = job.criticalKeywords.filter(kw => !supportedKeywordSet.has(kw.toLowerCase())).slice(0, 3);
  const evidenceIsWeak = total > 0 && postRules.bulletsWithNumbers < Math.max(1, Math.ceil(total * 0.3));
  const libraryLooksThin = total < 4 || selExps.filter(se => se.selectedBullets.length > 0).length <= 1;

  const whatMatches: string[] = [];
  if (topMatchedAspects.length > 0) {
    whatMatches.push(`Tes experiences selectionnees couvrent deja ${joinNatural(topMatchedAspects)}.`);
  }
  if (semanticScore >= 65) {
    whatMatches.push("Plusieurs bullets racontent deja un scope proche du role vise, meme sans reprendre tous les mots-cles.");
  }
  if (postRules.bulletsWithNumbers > 0) {
    whatMatches.push(`${postRules.bulletsWithNumbers} bullet${postRules.bulletsWithNumbers > 1 ? "s" : ""} apportent deja une preuve concrete ou chiffree.`);
  }
  if (whatMatches.length === 0 && total > 0) {
    whatMatches.push("Le moteur a trouve quelques experiences pertinentes a reutiliser pour cette annonce.");
  }

  const whatMissing: string[] = [];
  if (domainMismatch === "PO/PM vs Designer") {
    whatMissing.push("Tes bullets montrent surtout du design craft, pas assez de pilotage produit, backlog ou priorisation.");
  } else if (domainMismatch === "Designer vs PO") {
    whatMissing.push("Tes bullets montrent surtout du pilotage produit, pas assez de craft UX/UI ou de design execution.");
  } else if (domainMismatch === "retail-sales") {
    whatMissing.push("Ce poste est en management commercial terrain (coaching equipe de vente, objectifs, client portfolio) — domaine different du design produit.");
  } else if (domainMismatch === "project-management") {
    whatMissing.push("Ce poste demande de la methodologie projet formelle (jalons, livrables, MOE/MOA, pilotage de planning) — absente de ta bibliotheque design.");
  } else if (domainMismatch === "data-analytics") {
    whatMissing.push("Ce poste demande des competences techniques data (SQL, BI, stats, machine learning) — hors du perimetre design produit.");
  } else if (domainMismatch === "development") {
    whatMissing.push("Ce poste demande des competences de developpement logiciel (code, architecture, deploiement) — hors du perimetre design produit.");
  }
  if (topMissingKeywords.length > 0) {
    whatMissing.push(`Les competences metier critiques ${joinNatural(topMissingKeywords)} ne ressortent pas assez dans le CV genere.`);
  }
  if (evidenceGapIsHigh) {
    whatMissing.push("Le CV final reprend mieux le vocabulaire de l'annonce que ce que ta bibliotheque prouve reellement aujourd'hui.");
  }
  if (evidenceIsWeak) {
    whatMissing.push("Le fond est proche, mais les bullets retenus manquent encore de preuves concretes : scope, chiffres ou avant/apres.");
  }
  if (libraryLooksThin) {
    whatMissing.push("La bibliotheque actuelle donne peu de matiere vraiment exploitable pour cette annonce.");
  }

  let primaryDiagnosis: PrimaryDiagnosis;
  let verdict: string;
  if (domainMismatch) {
    primaryDiagnosis = "Mismatch de metier";
    verdict = domainMismatch === "retail-sales"
      ? "Hors domaine : ce poste est en vente retail, pas en design produit. Le score faible est une information utile, pas un bug."
      : domainMismatch === "project-management"
      ? "Domaine adjacent : certaines competences se transferent (structuration, alignement), mais le coeur chef de projet est absent de ta bibliotheque."
      : domainMismatch === "data-analytics"
      ? "Hors domaine : ce poste demande des competences data technique qui ne font pas partie de ton profil design."
      : domainMismatch === "development"
      ? "Hors domaine : ce poste est en developpement logiciel. Le profil design ne correspond pas aux attendus techniques."
      : "Profil adjacent : une partie de ton experience se transfere, mais le coeur du role demande est different.";
  } else if (seniorityMismatch) {
    primaryDiagnosis = "Competences metier critiques absentes";
    verdict = seniorityMismatch === "over-qualified"
      ? "Niveau de poste trop junior pour ton profil : le recruteur privilegiera un candidat moins experimente. Cible des postes senior ou lead."
      : "Niveau de poste trop senior pour ton profil actuel : renforce d'abord les preuves de ton impact avant de viser ce niveau.";
  } else if (libraryLooksThin) {
    primaryDiagnosis = "Bibliotheque insuffisamment detaillee";
    verdict = "Match difficile a juger : ta bibliotheque actuelle ne donne pas encore assez de matiere solide pour cette annonce.";
  } else if (!domainMismatch && semanticScore >= 60 && evidenceScore >= 25) {
    // Bon fit metier, mais les preuves manquent dans les bullets
    primaryDiagnosis = "Experience proche mais preuves trop faibles";
    verdict = evidenceGapIsHigh
      ? "Bon profil pour ce role, mais le CV optimise couvre plus de mots-cles que ce que ta bibliotheque prouve vraiment. Renforce les bullets sources."
      : "Ton profil est proche de ce role, mais les competences cles manquent encore dans les bullets selectionnes. Renforce la preuve avant d'optimiser le texte.";
  } else if (cappedByKeywords || cappedByEvidence || evidenceScore < 40 || topMissingKeywords.length >= 2) {
    primaryDiagnosis = "Competences metier critiques absentes";
    verdict = evidenceGapIsHigh
      ? "Match fragile : le CV final couvre mieux les mots-cles de l'annonce que ce que ta bibliotheque prouve reellement."
      : "Match partiel : le fond peut coller, mais les competences metier cles de l'annonce ne ressortent pas assez dans ton CV.";
  } else if (evidenceIsWeak || semanticScore < 65) {
    primaryDiagnosis = "Experience proche mais preuves trop faibles";
    verdict = "Experience proche, mais pas encore assez prouvee dans les bullets retenus.";
  } else {
    primaryDiagnosis = "Bon alignement global";
    verdict = "Bon alignement global : ton profil colle deja bien a cette annonce.";
  }

  const nextActions: string[] = [];
  if (primaryDiagnosis === "Mismatch de metier") {
    if (domainMismatch === "retail-sales") {
      nextActions.push("Ce poste necessite une experience de management d'equipe de vente terrain. Si tu vises ce secteur, construis d'abord cette experience.");
      nextActions.push("Concentre-toi sur des postes design produit ou UX Lead ou ce profil est directement valorise.");
    } else if (domainMismatch === "project-management") {
      nextActions.push("Si tu vises la gestion de projet, ajoute des bullets qui montrent pilotage, jalons, budget ou reporting de projet.");
      nextActions.push("Les experiences de structuration et d'alignement se valorisent mieux sur des postes design lead ou product.");
    } else if (domainMismatch === "data-analytics") {
      nextActions.push("Si tu vises la data, il faut construire des competences techniques (SQL, Python, BI) avant de postuler.");
      nextActions.push("Des postes UX Research ou Product Analytics sont plus accessibles depuis un profil design.");
    } else if (domainMismatch === "development") {
      nextActions.push("Si tu vises le dev, il faut acquerir des competences techniques (code, frameworks, architecture) avant de postuler.");
      nextActions.push("Des postes Design System, DesignOps ou Design Engineer sont plus accessibles depuis un profil design.");
    } else if (jobTitleLow.includes("product")) {
      nextActions.push("Ajoute des bullets ancres dans backlog, roadmap, priorisation ou delivery produit.");
      nextActions.push("Garde les experiences transferables, mais prouve davantage le coeur du metier vise.");
    } else {
      nextActions.push(`Ajoute des bullets ancres dans ${joinNatural(job.criticalKeywords.slice(0, 3)) || "les attendus coeur metier du poste"}.`);
      nextActions.push("Garde les experiences transferables, mais prouve davantage le coeur du metier vise.");
    }
  } else if (primaryDiagnosis === "Competences metier critiques absentes") {
    nextActions.push(`Fais remonter explicitement ${joinNatural(topMissingKeywords.length ? topMissingKeywords : job.criticalKeywords.slice(0, 3))} dans tes bullets ou dans ta bibliotheque.`);
    nextActions.push("Ajoute 2 ou 3 bullets qui montrent ces competences dans un contexte reel, pas seulement en liste de skills.");
  } else if (primaryDiagnosis === "Bibliotheque insuffisamment detaillee") {
    nextActions.push("Enrichis 1 ou 2 experiences proches de l'offre avec 3 a 5 bullets detailles.");
    nextActions.push("Ajoute du contexte, du scope, des resultats et des tags sur les experiences les plus proches.");
  } else if (primaryDiagnosis === "Experience proche mais preuves trop faibles") {
    nextActions.push("Reecris 2 ou 3 bullets avec du scope, des chiffres, ou un avant/apres concret.");
    nextActions.push("Precise ce que tu pilotais, pour qui, a quelle echelle, et avec quel impact.");
  } else {
    nextActions.push("Garde cette base et renforce seulement les bullets les plus faibles pour augmenter le taux de match.");
  }

  const recruiterCredibility = getRecruiterCredibility({
    fitOffer,
    evidenceScore,
    semanticScore,
    domainMismatch,
    evidenceGapIsHigh,
    libraryLooksThin,
    evidenceIsWeak,
  });
  const rankedCauses = rankDiagnosisCauses({
    job,
    selExps,
    fitOffer,
    legacyConfidence: confidence,
    evidenceScore,
    atsOptimized,
    atsBoost,
    semanticScore,
    contextSupport,
    libraryLooksThin,
    evidenceIsWeak,
    domainMismatch,
  });
  let primaryCause = rankedCauses[0] || "bullets_too_generic";
  let secondaryCauses = rankedCauses.slice(1, 3);
  let recommendedAction = recommendedActionForCause(primaryCause, nextActions[0] || "Renforce la preuve metier avant de regagner de l'ATS.");

  // ─── V2 scoring (profile frame based) ──────────────────────────────────────
  const v2fitMetier = Math.round(semanticScore * 0.8);
  const v2fitNiveauFactor = 1.0;
  const v2distanceDomain = (domainMismatch ? "different" : "same") as DistanceDomain;

  // Force de preuve: how well the bullets PROVE the fit
  const bulletsWithProof = allBullets.filter(b => /\d+/.test(b.bullet.text) || /scope|impact|resultat|chiffre|avant.apr|pilotage|budget|equipe de \d/i.test(b.bullet.text)).length;
  const proofRatio = total > 0 ? bulletsWithProof / total : 0;
  // Tier 1 keywords: structural competencies (non-tool keywords)
  const tier1Keywords = job.criticalKeywords.filter(kw => !isSpecificToolKeyword(kw));
  const tier1Covered = tier1Keywords.filter(kw => {
    const covered = postRules.evidenceKeywordsCovered.some(c => normalizeEvidenceText(c) === normalizeEvidenceText(kw));
    const aliasMatch = (() => {
      const group = findKeywordAliasGroup(kw);
      if (!group) return false;
      return postRules.evidenceKeywordsCovered.some(c => findKeywordAliasGroup(c)?.key === group.key);
    })();
    return covered || aliasMatch;
  }).length;
  const tier1Ratio = tier1Keywords.length > 0 ? tier1Covered / tier1Keywords.length : 0.5;
  // Density of relevant bullets (échelle 150 : 85 ≈ ancien 70 sur 120)
  const highScoredBullets = allBullets.filter(b => b.totalScore >= 85).length;
  const densityRatio = total > 0 ? highScoredBullets / total : 0;
  const v2forcePreuve = Math.round(
    (proofRatio * 0.4 + tier1Ratio * 0.4 + densityRatio * 0.2) * 100,
  );

  // Credibilite CV: how well the generated CV proves what fit promises
  const cvFullText = cv.experiences.flatMap(e => e.bullets).join(" ") + " " + (cv.summary || "");
  const tier1InCv = tier1Keywords.filter(kw => textHasKeyword(cvFullText, kw)).length;
  const keywordsProvedInCv = tier1Keywords.length > 0 ? tier1InCv / tier1Keywords.length : 0.5;
  // Bullets quality heuristic
  const cvBullets = cv.experiences.flatMap(e => e.bullets);
  const cvBulletsWithNumbers = cvBullets.filter(b => /\d+/.test(b)).length;
  const cvBulletsQuality = cvBullets.length > 0 ? cvBulletsWithNumbers / cvBullets.length : 0;
  const v2credibiliteCv = Math.round(
    (keywordsProvedInCv * 0.5 + (1 - Math.min(1, atsBoost / 60)) * 0.3 + cvBulletsQuality * 0.2) * 100,
  );

  // Pertinence: the single visible score (linear composition, no hard caps)
  const v2pertinence = Math.min(100, Math.round(
    v2fitMetier * 0.5 + v2fitNiveauFactor * 15 + v2forcePreuve * 0.35,
  ));

  // Badge
  const v2badge: BadgeLevel =
    v2credibiliteCv >= 65 && v2distanceDomain === "same" ? "probant"
    : v2credibiliteCv >= 40 || (v2distanceDomain === "adjacent" && v2fitMetier >= 50) ? "a_renforcer"
    : "fragile";

  // ─── V2 diagnostic (axis-based, replaces cap-based) ───────────────────────
  log("v2 scoring", {
    fitMetier: v2fitMetier,
    forcePreuve: v2forcePreuve,
    credibiliteCv: v2credibiliteCv,
    pertinence: v2pertinence,
    badge: v2badge,
    distanceDomain: v2distanceDomain,
  });

  return { jobTitle: job.title, jobCompany: job.company, jobSeniority: job.seniority, jobDomain: job.domain, detectedKeywords: { requiredSkills: job.requiredSkills, preferredSkills: job.preferredSkills, responsibilities: job.responsibilities, keywords: job.keywords, criticalKeywords: job.criticalKeywords }, matchedSkills: matched.map(s => s.name), missingSkills: missingSkills.slice(0, 10), selectedExperiences: selExps.map(se => ({ title: se.experience.title, company: se.experience.company, score: Math.round(se.score), reason: se.reason, matchedAspects: se.matchedAspects, bulletCount: se.selectedBullets.length, charBudget: se.charBudget })), rejectedExperiences: [], selectedBullets: allBullets.map(sb => ({ text: sb.bullet.text, experienceTitle: sb.experience.title, score: sb.totalScore, deterministicScore: sb.deterministicScore, llmScore: sb.llmScore, matchedKeywords: sb.matchedKeywords, dimension: sb.dimension })), postRules, confidence, confidenceReasoning: verdict, fallbackUsed: total === 0, detectedLanguage: job.language, positioning: job.positioning, intentions: job.intentions, productMaturity: job.productMaturity, complexityLevel: job.complexityLevel, ownershipLevel: job.ownershipLevel, tips, diagnosis: { primaryDiagnosis, verdict, whatMatches: whatMatches.slice(0, 3), whatMissing: whatMissing.slice(0, 3), nextActions: nextActions.slice(0, 3), primaryCause, secondaryCauses, recommendedAction }, scoreBreakdown: { fitOffer, ats: atsEvidence, atsOptimized, atsBoost, contextSupport, semantic: semanticScore, recruiterCredibility, domainMismatch, cappedByKeywords, cappedByEvidence, pertinence: v2pertinence, fitMetier: v2fitMetier, fitNiveauFactor: v2fitNiveauFactor, fitNiveau: "uncertain", forcePreuve: v2forcePreuve, credibiliteCv: v2credibiliteCv, evidenceGrounding: v2forcePreuve, recruiterCredibilityScore: v2credibiliteCv, atsReadiness: atsOptimized, overstatementRisk: domainMismatch ? 70 : Math.max(15, Math.round(atsBoost * 1.2)), badge: v2badge, distanceDomain: v2distanceDomain } };
}

// ── Dry Run Check (steps 1-4 only, no CV generation, no DB save) ──
export interface JobProfileAssessment {
  zoneScore: number;               // 0-100: % of job requirements covered by profile tags/skills
  positioningMatch: "aligned" | "adjacent" | "stretch";
  verdict: "worth_applying" | "possible_but_niche" | "likely_overreach";
  signals: string[];               // 2-3 human-readable signals
}

function buildJobProfileAssessment(
  parsedJob: ParsedJob,
  allBullets: Bullet[],
  allSkills: Skill[],
  allExperiences: Experience[],
): JobProfileAssessment {
  // Collect all tags from bullets + skill names → the user's "vocabulary"
  const profileTags = new Set<string>();
  for (const bullet of allBullets) {
    for (const tag of bullet.tags || []) {
      profileTags.add(tag.toLowerCase().trim());
    }
    // Also add significant words from bullet text for richer coverage
    const words = bullet.text.toLowerCase().split(/\s+/);
    for (const w of words) {
      if (w.length >= 5) profileTags.add(w);
    }
  }
  for (const skill of allSkills) {
    profileTags.add(skill.name.toLowerCase().trim());
  }
  for (const exp of allExperiences) {
    const titleWords = exp.title.toLowerCase().split(/\s+/);
    for (const w of titleWords) {
      if (w.length >= 4) profileTags.add(w);
    }
    if (exp.description) {
      const descWords = exp.description.toLowerCase().split(/\s+/);
      for (const w of descWords) {
        if (w.length >= 5) profileTags.add(w);
      }
    }
  }

  // Score: how many job requirements appear in profile tags
  const jobRequirements = [
    ...parsedJob.criticalKeywords,
    ...parsedJob.requiredSkills,
  ];

  let covered = 0;
  const coveredTerms: string[] = [];
  const missingTerms: string[] = [];

  for (const kw of jobRequirements) {
    const kwNorm = kw.toLowerCase().trim();
    const found =
      profileTags.has(kwNorm) ||
      [...profileTags].some(tag => tag.includes(kwNorm) || kwNorm.includes(tag)) ||
      textHasKeyword([...profileTags].join(" "), kw);
    if (found) {
      covered++;
      coveredTerms.push(kw);
    } else {
      missingTerms.push(kw);
    }
  }

  const zoneScore = jobRequirements.length > 0
    ? Math.round((covered / jobRequirements.length) * 100)
    : 50;

  // Positioning match: compare job positioning with profile seniority + title signals
  const profileSeniority = inferProfileSeniority(allExperiences);
  const jobPositioning = parsedJob.positioning;
  const jobSeniorityStr = parsedJob.seniority?.toLowerCase() || "";
  const isJobJunior = /stage|intern|junior|alternance/.test(jobSeniorityStr);
  const isJobDirector = /director|directeur|vp|head of|c-level/.test(jobSeniorityStr);

  let positioningMatch: JobProfileAssessment["positioningMatch"];
  if (isJobJunior && (profileSeniority === "senior")) {
    positioningMatch = "stretch"; // over-qualified
  } else if (isJobDirector && profileSeniority === "junior") {
    positioningMatch = "stretch"; // under-qualified
  } else if (jobPositioning === "manager" && profileSeniority === "junior") {
    positioningMatch = "adjacent";
  } else if (zoneScore >= 50) {
    positioningMatch = "aligned";
  } else if (zoneScore >= 25) {
    positioningMatch = "adjacent";
  } else {
    positioningMatch = "stretch";
  }

  // Verdict
  let verdict: JobProfileAssessment["verdict"];
  if (zoneScore >= 50 && positioningMatch === "aligned") {
    verdict = "worth_applying";
  } else if (zoneScore >= 25 || positioningMatch === "adjacent") {
    verdict = "possible_but_niche";
  } else {
    verdict = "likely_overreach";
  }

  // Build signals
  const signals: string[] = [];
  if (coveredTerms.length > 0) {
    signals.push(`Termes reconnus dans ton profil : ${coveredTerms.slice(0, 3).join(", ")}`);
  }
  if (missingTerms.length > 0) {
    signals.push(`Termes absents de ta bibliotheque : ${missingTerms.slice(0, 3).join(", ")}`);
  }
  if (positioningMatch === "stretch" && isJobJunior) {
    signals.push("Poste junior ou stage : ton profil parait plus senior");
  } else if (positioningMatch === "stretch" && isJobDirector) {
    signals.push("Poste directorial : ton scope actuel est en-dessous");
  } else if (positioningMatch === "adjacent") {
    signals.push("Metier adjacent : certains aspects du poste sont nouveaux pour ton profil");
  }

  return {
    zoneScore,
    positioningMatch,
    verdict,
    signals: signals.slice(0, 3),
  };
}

export interface DryRunResult {
  preliminaryConfidence: number;
  criticalKeywords: string[];
  positioning: string;
  jobTitle: string;
  viability: "good" | "viable" | "uncertain" | "weak";
  precheckVerdict: "go" | "prudence" | "faible_chance";
  shouldWarn: boolean;
  warningMessage?: string;
  precheckMode: "fast" | "deep";
  jobProfileAssessment?: JobProfileAssessment;
}

function getPrecheckViability(score: number): DryRunResult["viability"] {
  if (score >= 60) return "good";
  if (score >= 35) return "viable";
  if (score >= 18) return "uncertain";
  return "weak";
}

function getPrecheckMeta(score: number): Pick<DryRunResult, "viability" | "precheckVerdict" | "shouldWarn" | "warningMessage"> {
  const viability = getPrecheckViability(score);
  if (viability === "weak") {
    return {
      viability,
      precheckVerdict: "faible_chance",
      shouldWarn: true,
      warningMessage: "Le triage rapide voit peu de preuves directes pour cette offre. Tu peux continuer, mais la candidature parait faible a ce stade.",
    };
  }
  if (viability === "uncertain") {
    return {
      viability,
      precheckVerdict: "prudence",
      shouldWarn: false,
      warningMessage: "Le triage rapide reste prudent: ton profil peut rester viable, mais l'annonce demande probablement une lecture plus fine.",
    };
  }
  return {
    viability,
    precheckVerdict: viability === "good" || viability === "viable" ? "go" : "prudence",
    shouldWarn: false,
  };
}

export async function runDryRunCheck(input: Pick<TailorInput, "jobText" | "mode" | "bodyMaxChars" | "allExperiences" | "allBullets" | "allSkills" | "embeddingStore">, openai: OpenAI): Promise<DryRunResult> {
  log("══════ Dry Run Check (steps 1-4) ══════");
  const sanitizedInput = sanitizeTailorInput({
    ...input,
    profile: undefined,
    formations: [],
    languages: [],
  });
  const parsedJob = await parseJobDescription(sanitizedInput.jobText, openai);
  const scored = await hybridScoreAllBullets(parsedJob, sanitizedInput.allExperiences, sanitizedInput.allBullets, openai, input.embeddingStore);
  const allocs = allocateCharBudget(sanitizedInput.allExperiences, scored, sanitizedInput.bodyMaxChars || 3500);
  const selExps = selectBullets(scored, allocs, parsedJob);
  const allSelectedBullets = selExps.flatMap(se => se.selectedBullets);
  const total = allSelectedBullets.length;
  const avg = total > 0 ? Math.round(allSelectedBullets.reduce((s, b) => s + b.totalScore, 0) / total) : 0;
  const selectedEvidenceText = allSelectedBullets
    .map(sb => `${sb.bullet.text} ${(sb.bullet.tags || []).join(" ")}`)
    .join(" ");
  const coveredCount = parsedJob.criticalKeywords.filter(keyword => textHasKeyword(selectedEvidenceText, keyword)).length;
  const kwCov = parsedJob.criticalKeywords.length > 0 ? Math.round(coveredCount / parsedJob.criticalKeywords.length * 100) : 50;
  const bulletBonus = total >= 6 ? Math.min(10, Math.round(kwCov * 0.1)) : Math.round(total * 1.5);
  const rawConfidence = Math.round(avg * 0.45 + kwCov * 0.45 + bulletBonus);
  const critKwHardCap = parsedJob.criticalKeywords.length >= 4 && kwCov < 25 ? 40 : 100;
  const preliminaryConfidence = Math.min(critKwHardCap, Math.min(100, rawConfidence));
  const precheckMeta = getPrecheckMeta(preliminaryConfidence);
  const jobProfileAssessment = buildJobProfileAssessment(
    parsedJob,
    sanitizedInput.allBullets,
    sanitizedInput.allSkills,
    sanitizedInput.allExperiences,
  );
  log(`Dry Run Done - ${preliminaryConfidence}% | ${parsedJob.positioning} | zone:${jobProfileAssessment.zoneScore}%`);
  return {
    preliminaryConfidence,
    criticalKeywords: parsedJob.criticalKeywords,
    positioning: parsedJob.positioning,
    jobTitle: parsedJob.title,
    ...precheckMeta,
    precheckMode: "deep",
    jobProfileAssessment,
  };
}

// ── Fast Dry Run (100% deterministic, 0 LLM calls) ──
export async function runFastDryRun(
  input: Pick<TailorInput, "jobText" | "allExperiences" | "allBullets">
): Promise<DryRunResult> {
  log("Fast Dry Run (deterministic)");

  const sanitizedExperiences = input.allExperiences.map(exp => ({
    ...exp,
    title: sanitizeTextValue(exp.title),
    company: sanitizeTextValue(exp.company),
    description: sanitizeOptionalTextValue(exp.description) || "",
  }));
  const sanitizedBullets = input.allBullets.map(bullet => ({
    ...bullet,
    text: sanitizeTextValue(bullet.text),
    tags: sanitizeTextList((bullet.tags || []) as string[]),
  }));
  const rawText = sanitizeTextValue(input.jobText);
  const tokenCandidates: string[] = [];
  const segments = rawText.split(/[,\n\r;\u2022\u2013\u2014-]+/);

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (trimmed.length >= 3 && trimmed.length <= 60) {
      tokenCandidates.push(trimmed);
    }
  }

  const wordMatches = rawText.match(/\b([A-Z][a-zA-Z]{2,}|[a-zA-Z]+\d+[a-zA-Z0-9]*|[A-Z]{2,})\b/g) || [];
  const allTokens: string[] = [
    ...tokenCandidates,
    ...wordMatches,
  ];

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const tok of allTokens) {
    const normalized = tok.trim().toLowerCase();
    if (normalized.length >= 3 && !seen.has(normalized)) {
      seen.add(normalized);
      keywords.push(tok.trim());
      if (keywords.length >= 20) break;
    }
  }

  const minimalParsedJob: ParsedJob = {
    title: "",
    company: "",
    seniority: "mid",
    domain: "",
    requiredSkills: keywords,
    preferredSkills: [],
    responsibilities: [],
    keywords,
    criticalKeywords: keywords.slice(0, 8),
    language: "FR",
    intentions: [],
    positioning: "ic",
    productMaturity: "unknown",
    complexityLevel: "unknown",
    ownershipLevel: "unknown",
    roleFrame: {
      workObjects: [],
      deliverables: [],
      decisions: [],
      collaborators: [],
      environments: [],
      scopeSignals: [],
    },
  };

  const expMap = new Map(sanitizedExperiences.map(e => [e.id, e]));
  const allKw = keywords.map(k => k.toLowerCase());
  const critKw = keywords.slice(0, 8).map(k => k.toLowerCase());

  const scored: ScoredBullet[] = sanitizedBullets.map(b => {
    const exp = expMap.get(b.experienceId);
    if (!exp) return null;
    const det = deterministicScore(b, exp, allKw, critKw, []);
    return {
      bullet: b,
      experience: exp,
      deterministicScore: det.score,
      llmScore: 0,
      semanticScore: 0,
      totalScore: det.score,
      matchedTags: det.matchedTags,
      matchedKeywords: det.matchedKeywords,
      dimension: inferDimension((b.tags || []).filter(Boolean)),
    } as ScoredBullet;
  }).filter(Boolean) as ScoredBullet[];

  const allocs = allocateCharBudget(sanitizedExperiences, scored, 3500);
  const selExps = selectBullets(scored, allocs, minimalParsedJob);
  const allSelectedBullets = selExps.flatMap(se => se.selectedBullets);

  const total = allSelectedBullets.length;
  const avg = total > 0 ? Math.round(allSelectedBullets.reduce((s, b) => s + b.totalScore, 0) / total) : 0;
  const selectedEvidenceText = allSelectedBullets
    .map(sb => `${sb.bullet.text} ${(sb.bullet.tags || []).join(" ")}`)
    .join(" ");
  const coveredCount = minimalParsedJob.criticalKeywords.filter(keyword => textHasKeyword(selectedEvidenceText, keyword)).length;
  const kwCov = critKw.length > 0 ? Math.round((coveredCount / critKw.length) * 100) : 50;
  const bulletBonus = total >= 6 ? Math.min(10, Math.round(kwCov * 0.1)) : Math.round(total * 1.5);
  const rawConfidence = Math.round(avg * 0.45 + kwCov * 0.45 + bulletBonus);
  const critKwHardCap = critKw.length >= 4 && kwCov < 25 ? 40 : 100;
  const preliminaryConfidence = Math.min(critKwHardCap, Math.min(100, rawConfidence));
  const precheckMeta = getPrecheckMeta(preliminaryConfidence);

  log("Fast Dry Run Done - " + preliminaryConfidence + "% | ic (deterministic)");
  return {
    preliminaryConfidence,
    criticalKeywords: minimalParsedJob.criticalKeywords,
    positioning: minimalParsedJob.positioning,
    jobTitle: minimalParsedJob.title,
    ...precheckMeta,
    precheckMode: "fast",
  };
}

// Master Pipeline
export interface TailorInput { jobText: string; mode: string; outputLength?: string; customMaxChars?: number; introMaxChars?: number; bodyMaxChars?: number; allExperiences: Experience[]; allBullets: Bullet[]; allSkills: Skill[]; profile?: { name?: string; title?: string; summary?: string | null }; formations?: any[]; languages?: any[]; embeddingStore?: EmbeddingStore; }
export interface TailorResult { cvText: string; structuredCV: StructuredCV; report: OptimizationReport; selectedExperienceIds: string[]; selectedBulletIds: string[]; }
const CHAR_LIMITS: Record<string, number> = { compact: 2000, balanced: 3500, detailed: 5500 };

function sanitizeTailorInput(input: TailorInput): TailorInput {
  return {
    ...input,
    jobText: sanitizeTextValue(input.jobText),
    allExperiences: input.allExperiences.map(exp => ({
      ...exp,
      title: sanitizeTextValue(exp.title),
      company: sanitizeTextValue(exp.company),
      description: sanitizeOptionalTextValue(exp.description) || "",
    })),
    allBullets: input.allBullets.map(bullet => ({
      ...bullet,
      text: sanitizeTextValue(bullet.text),
      tags: sanitizeTextList((bullet.tags || []) as string[]),
    })),
    allSkills: input.allSkills.map(skill => ({
      ...skill,
      name: sanitizeTextValue(skill.name),
    })),
    profile: input.profile
      ? {
          name: sanitizeOptionalTextValue(input.profile.name),
          title: sanitizeOptionalTextValue(input.profile.title),
          summary: sanitizeOptionalTextValue(input.profile.summary) || null,
        }
      : undefined,
    formations: (input.formations || []).map((formation: any) => ({
      ...formation,
      degree: sanitizeTextValue(formation.degree),
      school: sanitizeTextValue(formation.school),
      year: sanitizeOptionalTextValue(formation.year),
    })),
    languages: (input.languages || []).map((language: any) => ({
      ...language,
      name: sanitizeTextValue(language.name),
      level: sanitizeOptionalTextValue(language.level),
    })),
  };
}

export async function runTailorPipeline(input: TailorInput, openai: OpenAI): Promise<TailorResult> {
  log("Pipeline Start");
  const sanitizedInput = sanitizeTailorInput(input);
  const isFidele = sanitizedInput.mode === "original";
  const bodyChars = sanitizedInput.bodyMaxChars || sanitizedInput.customMaxChars || CHAR_LIMITS[sanitizedInput.outputLength || "balanced"] || 3500;
  const introChars = sanitizedInput.introMaxChars || 400;

  const parsedJob = await parseJobDescription(sanitizedInput.jobText, openai);
  // Une seule langue par CV : celle dans laquelle l'utilisateur a écrit ses
  // arguments. Traduire ses phrases reviendrait à écrire à sa place.
  const jobLanguage = parsedJob.language;
  const cvLanguage = detectLanguage(sanitizedInput.allBullets.map(b => b.text));
  parsedJob.language = cvLanguage;
  const scored = await hybridScoreAllBullets(parsedJob, sanitizedInput.allExperiences, sanitizedInput.allBullets, openai, input.embeddingStore);
  const allocs = allocateCharBudget(sanitizedInput.allExperiences, scored, bodyChars);
  const faithfulSelExps = selectBullets(scored, allocs, parsedJob, { strategy: "faithful" });
  const baseCv = await buildStructuredCV(parsedJob, faithfulSelExps, sanitizedInput.allSkills, "original", openai, { profileName: sanitizedInput.profile?.name, profileTitle: sanitizedInput.profile?.title, profileSummary: sanitizedInput.profile?.summary || undefined, formations: sanitizedInput.formations, languages: sanitizedInput.languages });
  if (baseCv.summary && baseCv.summary.length > introChars) { baseCv.summary = baseCv.summary.slice(0, introChars).replace(/[,;]?\s*\S*$/, "").trim(); }

  const baselineCv = cloneStructuredCV(baseCv);
  const baselinePostRules = applyPostRules(baselineCv, parsedJob);
  // V2 = structural scaffold: deterministic report, diagnostic text, ATS metrics.
  // Its scores are used as the fallback starting point if V3 (LLM eval) fails.
  // V3 = source of truth: evaluateGeneratedCvVariants judges the actual generated
  // document against its source evidence and overrides V2 scores via applyGeneratedCvAssessment.
  const baselineRawReport = generateOptimizationReport(parsedJob, faithfulSelExps, sanitizedInput.allSkills, baselinePostRules, baselineCv);
  const baselineFallbackAssessment = assessmentFromLegacyReport(baselineRawReport);
  const baselineText = renderCVText(baselineCv, parsedJob);
  const initialAppliedReport = applyGeneratedCvAssessment(baselineRawReport, baselineFallbackAssessment, "legacy_fallback", baselineText, sanitizedInput.jobText);
  const initialOptimizationDecision: NonNullable<OptimizationReport["scoreBreakdown"]["optimizationDecision"]> = isFidele ? "faithful_only" : "optimized_rejected";

  let finalCv = baselineCv;
  let finalSelExps = faithfulSelExps;
  let finalReport: OptimizationReport = {
    ...initialAppliedReport,
    scoreBreakdown: {
      ...initialAppliedReport.scoreBreakdown,
      optimizationDecision: initialOptimizationDecision,
      optimizationNotes: isFidele
        ? ["Mode fidele: le moteur conserve la version la plus prudente et la plus ancree."]
        : ["Optimisation non evaluee: version fidele conservee par defaut."],
      variantStrategy: "faithful",
    },
  };

  if (!isFidele) {
    const optimizedSelExps = selectBullets(scored, allocs, parsedJob, { strategy: "optimized" });
    const optimizedBaseCv = await buildStructuredCV(parsedJob, optimizedSelExps, sanitizedInput.allSkills, "optimized", openai, {
      profileName: sanitizedInput.profile?.name,
      profileTitle: sanitizedInput.profile?.title,
      profileSummary: sanitizedInput.profile?.summary || undefined,
      formations: sanitizedInput.formations,
      languages: sanitizedInput.languages,
    });
    if (optimizedBaseCv.summary && optimizedBaseCv.summary.length > introChars) {
      optimizedBaseCv.summary = optimizedBaseCv.summary.slice(0, introChars).replace(/[,;]?\s*\S*$/, "").trim();
    }

    const candidateCv = await composeCVDocument(cloneStructuredCV(optimizedBaseCv), parsedJob, openai, {
      candidates: pickRewriteCandidates(optimizedBaseCv, optimizedSelExps),
      rewriteSummary: true,
    });
    const candidateReportCv = cloneStructuredCV(candidateCv);
    const candidatePostRules = applyPostRules(candidateReportCv, parsedJob);
    const candidateRawReport = generateOptimizationReport(parsedJob, optimizedSelExps, sanitizedInput.allSkills, candidatePostRules, candidateReportCv);
    const candidateFallbackAssessment = assessmentFromLegacyReport(candidateRawReport);
    const candidateText = renderCVText(candidateReportCv, parsedJob);

    const evaluation = await evaluateGeneratedCvVariants({
      job: parsedJob,
      faithfulSelExps,
      faithfulCv: baselineCv,
      faithfulFallback: baselineFallbackAssessment,
      optimizedSelExps,
      optimizedCv: candidateReportCv,
      optimizedFallback: candidateFallbackAssessment,
      openai,
    });

    const baselineReport = applyGeneratedCvAssessment(baselineRawReport, evaluation.faithful, evaluation.scoreModel, baselineText, sanitizedInput.jobText);
    const candidateReport = applyGeneratedCvAssessment(candidateRawReport, evaluation.optimized || candidateFallbackAssessment, evaluation.scoreModel, candidateText, sanitizedInput.jobText);
    const baselineAtsFinal = baselineReport.scoreBreakdown.atsOptimized ?? baselineReport.scoreBreakdown.ats;
    const candidateAtsFinal = candidateReport.scoreBreakdown.atsOptimized ?? candidateReport.scoreBreakdown.ats;
    const baselineRisk = baselineReport.scoreBreakdown.overstatementRisk;
    const candidateRisk = candidateReport.scoreBreakdown.overstatementRisk;
    const baselineIntegrity = baselineReport.scoreBreakdown.textIntegrityScore ?? 100;
    const candidateIntegrity = candidateReport.scoreBreakdown.textIntegrityScore ?? 100;
    const candidateIsNonRegressive =
      candidateReport.scoreBreakdown.pertinence >= baselineReport.scoreBreakdown.pertinence
      && candidateReport.scoreBreakdown.credibiliteCv >= baselineReport.scoreBreakdown.credibiliteCv
      && candidateAtsFinal >= baselineAtsFinal
      && candidateRisk <= baselineRisk + 5
      && candidateIntegrity >= baselineIntegrity;
    const candidateAddsValue =
      candidateReport.scoreBreakdown.pertinence > baselineReport.scoreBreakdown.pertinence
      || candidateReport.scoreBreakdown.credibiliteCv > baselineReport.scoreBreakdown.credibiliteCv
      || candidateAtsFinal > baselineAtsFinal
      || candidateRisk < baselineRisk
      || candidateReport.scoreBreakdown.textIntegrityScore !== baselineReport.scoreBreakdown.textIntegrityScore;
    const sharedNotes = evaluation.notes || [];

    if (candidateIsNonRegressive && candidateAddsValue) {
      finalCv = candidateReportCv;
      finalSelExps = optimizedSelExps;
      finalReport = {
        ...candidateReport,
        scoreBreakdown: {
          ...candidateReport.scoreBreakdown,
          optimizationDecision: "optimized_selected" as const,
          optimizationNotes: uniqueItems([
            ...sharedNotes,
            "Version optimisee retenue: selection de preuves et formulation plus convaincantes sans regression visible.",
          ]),
          variantStrategy: "optimized_humain" as const,
        },
      };
    } else {
      finalReport = {
        ...baselineReport,
        scoreBreakdown: {
          ...baselineReport.scoreBreakdown,
          optimizationDecision: "optimized_rejected" as const,
          optimizationNotes: uniqueItems([
            ...sharedNotes,
            "Version optimisee rejetee: elle n'apporte pas assez de gain net ou introduit une regression de credibilite.",
          ]),
          variantStrategy: "faithful" as const,
        },
      };
      log("reformulate rejected (generated-cv guard)", {
        baselinePertinence: baselineReport.scoreBreakdown.pertinence,
        candidatePertinence: candidateReport.scoreBreakdown.pertinence,
        baselineCredibilite: baselineReport.scoreBreakdown.credibiliteCv,
        candidateCredibilite: candidateReport.scoreBreakdown.credibiliteCv,
        baselineRisk,
        candidateRisk,
        baselineAtsFinal,
        candidateAtsFinal,
        baselineIntegrity,
        candidateIntegrity,
        scoreModel: evaluation.scoreModel,
        notes: evaluation.notes,
      });
    }
  } else {
    const evaluation = await evaluateGeneratedCvVariants({
      job: parsedJob,
      faithfulSelExps,
      faithfulCv: baselineCv,
      faithfulFallback: baselineFallbackAssessment,
      openai,
    });
    const faithfulReport = applyGeneratedCvAssessment(baselineRawReport, evaluation.faithful, evaluation.scoreModel, baselineText, sanitizedInput.jobText);
    finalReport = {
      ...faithfulReport,
      scoreBreakdown: {
        ...faithfulReport.scoreBreakdown,
        optimizationDecision: "faithful_only",
        optimizationNotes: uniqueItems([
          ...(evaluation.notes || []),
          "Mode fidele: aucune re-selection agressive ni reformulation d'optimisation appliquee.",
        ]),
        variantStrategy: "faithful",
      },
    };
  }

  const cvText = finalCv === baselineCv ? baselineText : renderCVText(finalCv, parsedJob);
  const languageTip = jobLanguage !== cvLanguage
    ? [`L'offre est en ${jobLanguage === "EN" ? "anglais" : "français"}, ta bibliothèque en ${cvLanguage === "EN" ? "anglais" : "français"} : le CV reste dans ta langue. Ajoute des formulations ${jobLanguage} dans la bibliothèque pour candidater dans la langue de l'offre.`]
    : [];
  finalReport = {
    ...finalReport,
    cvLanguage,
    jobLanguage,
    detectedLanguage: jobLanguage,
    structuredCV: finalCv,
    rewrites: finalCv.rewrites || [],
    tips: [...languageTip, ...finalReport.tips],
  };
  log(`Pipeline Done - pertinence=${finalReport.scoreBreakdown.pertinence}% badge=${finalReport.scoreBreakdown.badge} | ${parsedJob.positioning} | ${cvText.length} chars`);
  return {
    cvText,
    structuredCV: finalCv,
    report: finalReport,
    selectedExperienceIds: finalSelExps.filter(se => se.selectedBullets.length > 0).map(se => se.experience.id),
    selectedBulletIds: finalSelExps.flatMap(se => se.selectedBullets.map(sb => sb.bullet.id)),
  };
}

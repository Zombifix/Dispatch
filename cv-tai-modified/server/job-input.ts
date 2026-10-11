import { normalizeLinkedInUrl } from "./tailoring-engine";

// Récupération et nettoyage du texte d'une annonce (URL ou texte collé).
// Module sans dépendance à la base : testable isolément.
const BLOCKED_DOMAINS = [
  "indeed.com", "glassdoor.com", "monster.com",
  "apec.fr", "francetravail.fr", "pole-emploi.fr", "hellowork.com", "cadremploi.fr",
];

// ── Phase 1: In-memory scrape cache (TTL 5 min) ──
const SCRAPE_CACHE_TTL_MS = 5 * 60 * 1000;
const scrapeCache = new Map<string, { text: string; metadata: JobInputMetadata; timestamp: number }>();
const scrapeCacheSweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of scrapeCache) {
    if (now - entry.timestamp > SCRAPE_CACHE_TTL_MS) scrapeCache.delete(key);
  }
}, 10 * 60 * 1000);
scrapeCacheSweeper.unref();

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

export type JobInputMetadata = {
  sourceType: "url" | "text";
  normalizedUrl?: string;
  scrapeStatus: "success" | "blocked" | "failed" | "not_attempted";
  scrapeQuality: "good" | "uncertain" | "bad";
  scrapeMessage: string;
};

export type ResolvedJobInput = {
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
export function extractJsonLdJobPosting(html: string): string | null {
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

export function stripHtmlTags(html: string): string {
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

export function repairScrapeEncoding(text: string): string {
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

export function assessJobTextQuality(text: string): JobTextQualityAssessment {
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

export function isBlockedScrapeText(text: string): boolean {
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

export function sanitizeJobText(rawText: string): string {
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

export async function resolveJobInput(params: { url?: string; text?: string; extraContext?: string }): Promise<ResolvedJobInput> {
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

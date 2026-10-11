/**
 * Deterministic company-logo lookup for a job posting URL — no LLM involved.
 *
 * Order of preference:
 *   1. schema.org JobPosting `hiringOrganization.logo` (Welcome to the Jungle, most ATS, many career sites)
 *   2. LinkedIn public job page company logo (media.licdn.com "company-logo" image)
 *   3. Favicon of the company website declared in `hiringOrganization.url` / `sameAs`
 *   4. Favicon of the posting host itself, when it is the company's own career site (not a job board)
 *
 * Returns null when nothing trustworthy is found; the UI then falls back to the company initial.
 */

const JOB_BOARD_HOSTS = [
  "linkedin.com", "welcometothejungle.com", "indeed.", "glassdoor.", "monster.", "apec.fr",
  "francetravail.fr", "pole-emploi.fr", "hellowork.com", "cadremploi.fr", "jobteaser.com",
  "lever.co", "greenhouse.io", "workable.com", "smartrecruiters.com", "teamtailor.com",
  "recruitee.com", "myworkdayjobs.com", "workday.com", "taleo.net", "icims.com", "ashbyhq.com",
  "personio.", "breezy.hr", "jobvite.com", "successfactors.", "join.com", "talent.io", "malt.",
  "jobs.lu", "stepstone.", "meteojob.com", "regionsjob.com", "keljob.com", "jobijoba.",
];

const CAREER_SUBDOMAINS = new Set(["careers", "career", "jobs", "job", "recrutement", "emploi", "work", "apply", "join", "talents", "www"]);

const MAX_URL_LENGTH = 2048;

/** Refuse obviously internal targets (the URL comes from the user). */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host === "::1" ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    /^(fc|fd|fe80)[0-9a-f]*:/.test(host)
  );
}

function isJobBoard(hostname: string): boolean {
  return JOB_BOARD_HOSTS.some((board) => hostname.includes(board));
}

function toSafeHttpsUrl(raw: unknown, base?: string): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim().replace(/&amp;/g, "&"), base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.protocol = "https:";
    const value = url.toString();
    return value.length <= MAX_URL_LENGTH ? value : null;
  } catch {
    return null;
  }
}

/** Company domain without career-site prefixes: careers.louisvuitton.com → louisvuitton.com */
function companyDomain(hostname: string): string {
  const labels = hostname.toLowerCase().split(".");
  while (labels.length > 2 && CAREER_SUBDOMAINS.has(labels[0])) labels.shift();
  return labels.join(".");
}

export function faviconFor(hostname: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(companyDomain(hostname))}&sz=128`;
}

function findHiringOrganizations(html: string): any[] {
  const orgs: any[] = [];
  const scriptRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1].trim());
      const nodes: any[] = Array.isArray(data) ? data : data?.["@graph"] ? data["@graph"] : [data];
      for (const node of nodes) {
        const type = node?.["@type"];
        const isJobPosting = type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
        if (isJobPosting && node.hiringOrganization) orgs.push(node.hiringOrganization);
      }
    } catch {
      // invalid JSON-LD block — ignore
    }
  }
  return orgs;
}

/** Pure extraction from already-fetched HTML (exported for testing). */
export function extractCompanyLogo(html: string, pageUrl: string): string | null {
  let pageHost = "";
  try {
    pageHost = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return null;
  }

  const orgs = findHiringOrganizations(html);

  // 1. Declared logo
  for (const org of orgs) {
    const logo = typeof org.logo === "string" ? org.logo : org.logo?.url ?? org.logo?.contentUrl;
    const safe = toSafeHttpsUrl(logo, pageUrl);
    if (safe) return safe;
  }

  // 2. LinkedIn public job page
  if (pageHost.includes("linkedin.com")) {
    const licdn = html.match(/https:\/\/media\.licdn\.com\/dms\/image\/[^"'\s<>]*company-logo[^"'\s<>]*/i);
    const safe = toSafeHttpsUrl(licdn?.[0]);
    if (safe) return safe;
  }

  // 3. Company website declared by the posting
  for (const org of orgs) {
    const candidates = [org.url, ...(Array.isArray(org.sameAs) ? org.sameAs : [org.sameAs])];
    for (const candidate of candidates) {
      const safe = toSafeHttpsUrl(candidate, pageUrl);
      if (!safe) continue;
      const host = new URL(safe).hostname;
      if (!isJobBoard(host)) return faviconFor(host);
    }
  }

  // 4. The posting lives on the company's own career site
  if (!isJobBoard(pageHost)) return faviconFor(pageHost);

  return null;
}

/** Fetches the posting page and extracts a logo. Never throws. */
export async function resolveCompanyLogo(jobUrl: string | undefined | null): Promise<string | null> {
  if (!jobUrl) return null;
  let url: URL;
  try {
    url = new URL(jobUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (isPrivateHost(url.hostname)) return null;
  } catch {
    return null;
  }

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return isJobBoard(url.hostname) ? null : faviconFor(url.hostname);
    const html = (await res.text()).slice(0, 3_000_000);
    return extractCompanyLogo(html, res.url || url.toString());
  } catch {
    return isJobBoard(url.hostname) ? null : faviconFor(url.hostname);
  }
}

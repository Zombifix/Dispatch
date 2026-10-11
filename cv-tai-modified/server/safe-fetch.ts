import dns from "dns";
import http from "http";
import https from "https";
import net from "net";

/**
 * Récupération d'une page web fournie par un utilisateur, sans SSRF :
 * - http(s) uniquement, ports 80/443 ;
 * - chaque adresse résolue est vérifiée AU MOMENT de la connexion (lookup
 *   personnalisé) : pas de contournement par rebinding DNS ;
 * - adresses privées, locales, de lien local et de métadonnées cloud refusées ;
 * - redirections limitées et revérifiées ; taille et durée bornées.
 */

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127
      || (a === 100 && b >= 64 && b <= 127) // CGNAT
      || (a === 169 && b === 254) // lien local, métadonnées cloud
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224; // multicast, réservé
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return lower.startsWith("fc") || lower.startsWith("fd") // ULA
      || lower.startsWith("fe80") // lien local
      || lower.startsWith("ff"); // multicast
  }
  return true;
}

export function validatePublicUrl(raw: string): URL | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return null;
  if (net.isIP(host) && isPrivateAddress(host)) return null;
  return url;
}

const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = (Array.isArray(addresses) ? addresses : [addresses]) as dns.LookupAddress[];
    const allowed = list.filter(a => !isPrivateAddress(a.address));
    if (allowed.length === 0 || allowed.length !== list.length) {
      return callback(new Error(`Adresse non autorisée pour ${hostname}`), "", 4);
    }
    if ((options as dns.LookupOptions).all) return (callback as any)(null, allowed);
    callback(null, allowed[0].address, allowed[0].family);
  });
};

export async function safeFetchText(
  raw: string,
  opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; headers?: Record<string, string> } = {},
): Promise<{ status: number; text: string } | null> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  let current = validatePublicUrl(raw);
  for (let hop = 0; current && hop <= (opts.maxRedirects ?? 3); hop++) {
    const target = current;
    const result = await new Promise<{ status: number; text?: string; location?: string } | null>((resolve) => {
      const lib = target.protocol === "https:" ? https : http;
      const req = lib.request(target, {
        method: "GET",
        lookup: safeLookup,
        headers: { "Accept": "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0 (compatible; Dispatch/1.0)", ...opts.headers },
        timeout: timeoutMs,
      }, (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, location: new URL(res.headers.location, target).toString() });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) { req.destroy(); resolve(null); return; }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", () => resolve(null));
      });
      req.on("timeout", () => { req.destroy(); resolve(null); });
      req.on("error", () => resolve(null));
      req.end();
    });
    if (!result) return null;
    if (result.location) { current = validatePublicUrl(result.location); continue; }
    return { status: result.status, text: result.text || "" };
  }
  return null;
}

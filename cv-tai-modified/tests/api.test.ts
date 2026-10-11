import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import type { AddressInfo } from "net";

// Test d'API de bout en bout : application réelle + base jetable + faux fournisseur LLM local.
const dbUrl = process.env.TEST_DATABASE_URL;

let base = "";
let server: http.Server;
let fakeLlm: http.Server;
let pool: any;
let llmCalls = 0;
// 3 comptes maximum : la limite d'inscriptions par IP (3/heure) s'applique aussi au test.
let alice = "", bob = "", carol = "";

const JOB = {
  title: "Lead Product Designer", company: "Acme", seniority: "senior", domain: "SaaS",
  requiredSkills: ["Figma", "Design System"], preferredSkills: [], responsibilities: ["Structurer le design system"],
  keywords: ["Figma", "Design System"], criticalKeywords: ["Figma", "Design System"], language: "FR",
  intentions: ["structurer les pratiques"], positioning: "lead",
  roleFrame: { workObjects: ["design system"], deliverables: [], decisions: [], collaborators: [], environments: [], scopeSignals: [] },
};

function chatAnswer(body: any) {
  const first = String(body.messages?.[0]?.content || "");
  if (first.startsWith("Extract structured info")) return JOB;
  if (first.includes("Tu recois un bullet CV")) return { tags: ["Figma"], evaluation: { clarte: true, contexte: true, scope: true, impact: true, completude: true }, reasons: {}, suggestion: null };
  return {};
}

async function call(method: string, path: string, body?: unknown, cookie?: string) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* binaire ou vide */ }
  return { status: res.status, json, headers: res.headers, cookie: setCookie ? setCookie.split(";")[0] : undefined };
}

async function register(email: string) {
  const r = await call("POST", "/api/auth/register", { email, password: "Abcdefgh1" });
  expect(r.status).toBe(200);
  return r.cookie!;
}

describe.skipIf(!dbUrl)("API", () => {
  beforeAll(async () => {
    fakeLlm = http.createServer((req, res) => {
      let raw = "";
      req.on("data", c => (raw += c));
      req.on("end", () => {
        llmCalls++;
        const body = raw ? JSON.parse(raw) : {};
        res.setHeader("Content-Type", "application/json");
        if (req.url?.includes("/embeddings")) {
          res.end(JSON.stringify({ data: (body.input as string[]).map((_: string, index: number) => ({ index, embedding: [1, 0, 0] })) }));
          return;
        }
        res.end(JSON.stringify({ id: "x", object: "chat.completion", created: 0, model: "fake", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(chatAnswer(body)) } }] }));
      });
    });
    await new Promise<void>(r => fakeLlm.listen(0, "127.0.0.1", () => r()));

    process.env.DATABASE_URL = dbUrl;
    process.env.OPENAI_API_KEY = "test-key";
    process.env.LLM_BASE_URL = `http://127.0.0.1:${(fakeLlm.address() as AddressInfo).port}/v1`;
    process.env.LLM_DAILY_QUOTA = "4";
    process.env.NODE_ENV = "test";

    ({ pool } = await import("../server/db"));
    const { runMigrations } = await import("../server/migrate");
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;");
    await runMigrations(pool);
    const { createApp } = await import("../server/app");
    const { httpServer } = await createApp();
    server = httpServer;
    await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    fakeLlm?.close();
    await pool?.end();
  });

  it("envoie les en-têtes de sécurité et la sonde de santé", async () => {
    const r = await call("GET", "/healthz");
    expect(r.json).toEqual({ ok: true });
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-powered-by")).toBeNull();
  });

  it("protège les routes et refuse les entrées invalides", async () => {
    expect((await call("GET", "/api/experiences")).status).toBe(401);
    alice = await register("a@example.com");
    bob = await register("b@example.com");
    carol = await register("c@example.com");
    expect((await call("POST", "/api/auth/register", { email: "d@example.com", password: "Abcdefgh1" })).status).toBe(429);
    const c = alice;
    expect((await call("PUT", "/api/profile", { name: "A", userId: 999 }, c)).status).toBe(400);
    expect((await call("PUT", "/api/profile", { name: "Alex", title: "Product Designer" }, c)).status).toBe(200);
    expect((await call("POST", "/api/formations", { school: "", degree: "x" }, c)).status).toBe(400);
    const tailor = await call("POST", "/api/tailor", { url: "http://169.254.169.254/latest/meta-data", mode: "assembly" }, c);
    expect(tailor.status).toBe(400);
    expect(tailor.json.message).toMatch(/adresse web publique/);
  });

  it("assemble, exporte et suit une candidature, en isolant les utilisateurs", async () => {
    const c = bob;
    const exp = await call("POST", "/api/experiences", { title: "Product Designer", company: "Acme", startDate: "2021-01-01" }, c);
    for (const text of [
      "Conçoit le design system Figma utilisé par 4 équipes produit de la plateforme",
      "Mène 20 entretiens utilisateurs pour refondre le parcours de commande B2B",
    ]) expect((await call("POST", `/api/experiences/${exp.json.id}/bullets`, { text, tags: ["Figma"] }, c)).status).toBe(201);

    const offer = "Lead Product Designer chez Acme. Vous structurez le design system Figma et accompagnez les équipes produit. ".repeat(4)
      + "Missions : animer la critique design, faire évoluer les composants, travailler avec les PM et les développeurs.";
    const run = await call("POST", "/api/tailor", { text: offer, mode: "assembly" }, c);
    expect(run.status).toBe(201);
    expect(run.json.outputCvText).toContain("Conçoit le design system Figma");
    expect(run.json.outputReportJson.assembly.angle).toBe("lead");

    const docx = await call("GET", `/api/runs/${run.json.id}/export.docx`, undefined, c);
    expect(docx.status).toBe(200);
    expect(docx.headers.get("content-type")).toContain("wordprocessingml");

    const track = await call("PATCH", `/api/runs/${run.json.id}/tracking`, { tracking: { applied: true, status: "waiting", appliedAt: "2026-10-11", responseAt: "" } }, c);
    expect(track.status).toBe(200);
    expect((await call("PATCH", `/api/runs/${run.json.id}/tracking`, { tracking: { status: "piraté" } }, c)).status).toBe(400);

    const other = carol;
    expect((await call("GET", `/api/runs/${run.json.id}`, undefined, other)).status).toBe(404);
    expect((await call("GET", `/api/runs/${run.json.id}/export.docx`, undefined, other)).status).toBe(404);
  });

  it("applique le quota quotidien d'IA sans bloquer l'assemblage", async () => {
    const c = alice;
    const exp = await call("POST", "/api/experiences", { title: "PD", company: "Acme" }, c);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await call("POST", `/api/experiences/${exp.json.id}/tag-evaluate`, { text: "Conçoit le design system Figma de 4 équipes" }, c)).status);
    }
    expect(statuses.slice(0, 4)).toEqual([200, 200, 200, 200]);
    expect(statuses.slice(4)).toEqual([429, 429]);
    const info = await call("GET", "/api/settings/info", undefined, c);
    expect(info.json.usedToday).toBe(4);

    await call("POST", `/api/experiences/${exp.json.id}/bullets`, { text: "Conçoit le design system Figma utilisé par 4 équipes produit", tags: [] }, c);
    const offer = [
      "Product Designer (H/F) - SaaS B2B",
      "Description du poste : vous concevez les parcours de notre plateforme utilisée par 2 000 entreprises.",
      "Vos missions : faire évoluer le design system Figma, mener la recherche utilisateur, garantir l'accessibilité.",
      "Profil : 4 ans d'expérience en product design, maîtrise de Figma, goût pour le travail avec les PM et les développeurs.",
      "Vous serez rattaché au Head of Design et travaillerez en équipe produit de 8 personnes.",
    ].join("\n");
    const run = await call("POST", "/api/tailor", { text: offer, mode: "assembly" }, c);
    expect(run.status).toBe(201);
    expect(run.json.outputReportJson.assembly.jobReading).toBe("deterministe");
  });

  it("supprime un compte et toutes ses données, avec le bon mot de passe uniquement", async () => {
    const c = carol;
    await call("POST", "/api/experiences", { title: "PD", company: "Acme" }, c);
    expect((await call("DELETE", "/api/account", { password: "mauvais" }, c)).status).toBe(403);
    expect((await call("DELETE", "/api/account", { password: "Abcdefgh1" }, c)).status).toBe(204);
    const left = await pool.query("SELECT count(*)::int n FROM users WHERE email = 'c@example.com'");
    expect(left.rows[0].n).toBe(0);
    expect((await call("GET", "/api/experiences", undefined, c)).status).toBe(401);
  });
});

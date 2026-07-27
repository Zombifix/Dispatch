/**
 * Harness d'évaluation reproductible du moteur de tailoring.
 *
 * Usage :
 *   npm run eval                     — rejoue tout le corpus (analysis/corpus/)
 *   npm run eval -- --offer thales   — rejoue une seule offre (match sur le nom de fichier)
 *   npm run eval -- --export         — exporte library.json + offers/ depuis la DB
 *                                       (DATABASE_URL requis ; --user <id> optionnel, défaut: premier user)
 *
 * Corpus attendu :
 *   analysis/corpus/library.json         — { experiences, bullets, skills, profile?, formations?, languages? }
 *   analysis/corpus/offers/<nom>.json    — { name, jobText, expected?: { min, max, badges } }
 *
 * Les bandes cibles par défaut viennent de analysis/calibration_targets_2026-04-05.md.
 * Un champ `expected` dans le fichier d'offre les override.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { runTailorPipeline, type TailorInput } from "../server/tailoring-engine";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CORPUS_DIR = path.join(ROOT, "analysis", "corpus");
const OFFERS_DIR = path.join(CORPUS_DIR, "offers");
const RUNS_DIR = path.join(ROOT, "analysis", "eval_runs");

interface ExpectedBand { min: number; max: number; badges: string[]; note?: string }
interface OfferFile { name: string; jobText: string; expected?: Partial<ExpectedBand> }

// Bandes cibles issues de calibration_targets_2026-04-05.md (match par sous-chaîne du nom)
const DEFAULT_BANDS: Record<string, ExpectedBand> = {
  alan:      { min: 80, max: 88, badges: ["probant"], note: "strong fit" },
  thales:    { min: 72, max: 82, badges: ["a_renforcer", "probant"], note: "strong fit fragile" },
  thefork:   { min: 72, max: 82, badges: ["a_renforcer", "probant"], note: "strong fit fragile" },
  beelix:    { min: 60, max: 75, badges: ["a_renforcer"], note: "partial credible" },
  razer:     { min: 60, max: 75, badges: ["a_renforcer"], note: "partial credible" },
  behaviour: { min: 40, max: 65, badges: ["fragile", "a_renforcer"], note: "adjacent weak — jamais probant" },
  edtech:    { min: 40, max: 65, badges: ["fragile", "a_renforcer"], note: "adjacent weak" },
  edf:       { min: 0,  max: 25, badges: ["fragile"], note: "poor fit — jamais > 25" },
};

function expectedForOffer(offer: OfferFile): ExpectedBand | undefined {
  const key = Object.keys(DEFAULT_BANDS).find(k => offer.name.toLowerCase().includes(k));
  const base = key ? DEFAULT_BANDS[key] : undefined;
  if (!offer.expected && !base) return undefined;
  return {
    min: offer.expected?.min ?? base?.min ?? 0,
    max: offer.expected?.max ?? base?.max ?? 100,
    badges: offer.expected?.badges ?? base?.badges ?? ["probant", "a_renforcer", "fragile"],
    note: base?.note,
  };
}

function fail(msg: string): never {
  console.error(`\n[EVAL] ${msg}`);
  process.exit(1);
}

async function exportCorpus(userArg?: string) {
  const { db } = await import("../server/db");
  const schema = await import("../shared/schema");
  const { eq, asc } = await import("drizzle-orm");

  const users = await db.select().from(schema.users).orderBy(asc(schema.users.id));
  if (users.length === 0) fail("Aucun user en base.");
  const user = userArg ? users.find(u => String(u.id) === userArg || u.email === userArg) : users[0];
  if (!user) fail(`User introuvable: ${userArg}`);
  console.log(`[EVAL] Export library pour user ${user.id} (${user.email})`);

  const experiences = await db.select().from(schema.experiences).where(eq(schema.experiences.userId, user.id));
  const expIds = new Set(experiences.map(e => e.id));
  const allBullets = await db.select().from(schema.bullets);
  const bullets = allBullets.filter(b => expIds.has(b.experienceId));
  const skills = await db.select().from(schema.skills).where(eq(schema.skills.userId, user.id));
  const profileRows = await db.select().from(schema.profile).where(eq(schema.profile.userId, user.id));
  const formations = await db.select().from(schema.formations).where(eq(schema.formations.userId, user.id));
  const languagesRows = await db.select().from(schema.languages).where(eq(schema.languages.userId, user.id));

  fs.mkdirSync(OFFERS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(CORPUS_DIR, "library.json"),
    JSON.stringify({ experiences, bullets, skills, profile: profileRows[0] || null, formations, languages: languagesRows }, null, 2),
    "utf8",
  );
  console.log(`[EVAL] library.json écrit (${experiences.length} exps, ${bullets.length} bullets, ${skills.length} skills)`);

  const jobPosts = await db.select().from(schema.jobPosts).where(eq(schema.jobPosts.userId, user.id));
  let exported = 0;
  for (const jp of jobPosts) {
    if (!jp.rawText || jp.rawText.length < 200) continue;
    const title = ((jp.extractedJson as any)?.title || (jp.extractedJson as any)?.company || jp.id.slice(0, 8))
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    const file = path.join(OFFERS_DIR, `${title || jp.id.slice(0, 8)}.json`);
    if (fs.existsSync(file)) continue;
    fs.writeFileSync(file, JSON.stringify({ name: title, jobText: jp.rawText } satisfies OfferFile, null, 2), "utf8");
    exported++;
  }
  console.log(`[EVAL] ${exported} offres exportées vers analysis/corpus/offers/ (renomme-les avec les noms du corpus: alan, thales, beelix...)`);
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--export")) {
    const userIdx = args.indexOf("--user");
    await exportCorpus(userIdx >= 0 ? args[userIdx + 1] : undefined);
    return;
  }

  if (!process.env.OPENAI_API_KEY) fail("OPENAI_API_KEY requis pour rejouer le corpus.");
  const libraryPath = path.join(CORPUS_DIR, "library.json");
  if (!fs.existsSync(libraryPath)) {
    fail(`Corpus manquant: ${libraryPath}\nLance d'abord: npm run eval -- --export (avec DATABASE_URL), ou crée le fichier à la main.`);
  }
  const library = JSON.parse(fs.readFileSync(libraryPath, "utf8"));
  const offerFilter = (() => { const i = args.indexOf("--offer"); return i >= 0 ? args[i + 1]?.toLowerCase() : undefined; })();
  const offerFiles = fs.existsSync(OFFERS_DIR)
    ? fs.readdirSync(OFFERS_DIR).filter(f => f.endsWith(".json") && (!offerFilter || f.toLowerCase().includes(offerFilter)))
    : [];
  if (offerFiles.length === 0) fail(`Aucune offre dans ${OFFERS_DIR}${offerFilter ? ` (filtre: ${offerFilter})` : ""}`);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(RUNS_DIR, runStamp);
  fs.mkdirSync(outDir, { recursive: true });

  interface Row {
    offer: string;
    fidele: number; fideleBadge: string;
    optimise: number; optimiseBadge: string; decision: string;
    expected?: ExpectedBand;
    failures: string[];
  }
  const rows: Row[] = [];

  for (const file of offerFiles) {
    const offer: OfferFile = JSON.parse(fs.readFileSync(path.join(OFFERS_DIR, file), "utf8"));
    const name = offer.name || file.replace(/\.json$/, "");
    console.log(`\n[EVAL] ▶ ${name} (${offer.jobText.length} chars)`);
    const baseInput: Omit<TailorInput, "mode"> = {
      jobText: offer.jobText,
      outputLength: "balanced",
      allExperiences: library.experiences,
      allBullets: library.bullets,
      allSkills: library.skills,
      profile: library.profile ? { name: library.profile.name, title: library.profile.title, summary: library.profile.summary } : undefined,
      formations: library.formations || [],
      languages: library.languages || [],
    };

    const failures: string[] = [];
    try {
      const fidele = await runTailorPipeline({ ...baseInput, mode: "original" }, openai);
      const optimise = await runTailorPipeline({ ...baseInput, mode: "polished" }, openai);
      const fB = fidele.report.scoreBreakdown;
      const oB = optimise.report.scoreBreakdown;

      fs.writeFileSync(path.join(outDir, `${name}.fidele.txt`), fidele.cvText, "utf8");
      fs.writeFileSync(path.join(outDir, `${name}.optimise.txt`), optimise.cvText, "utf8");
      fs.writeFileSync(path.join(outDir, `${name}.report.json`), JSON.stringify({ fidele: fidele.report, optimise: optimise.report }, null, 2), "utf8");

      // ── Assertions dures (calibration_targets_2026-04-05.md) ──
      if (oB.pertinence < fB.pertinence) {
        failures.push(`optimise (${oB.pertinence}) < fidele (${fB.pertinence}) — interdit`);
      }
      const expected = expectedForOffer(offer);
      if (expected) {
        for (const [label, b] of [["fidele", fB], ["optimise", oB]] as const) {
          if (b.pertinence < expected.min || b.pertinence > expected.max) {
            failures.push(`${label} pertinence ${b.pertinence} hors bande [${expected.min}-${expected.max}]`);
          }
          if (b.badge && !expected.badges.includes(b.badge)) {
            failures.push(`${label} badge "${b.badge}" hors attendu [${expected.badges.join(", ")}]`);
          }
        }
      }
      if ((fB.textIntegrityScore ?? 100) < 98 || (oB.textIntegrityScore ?? 100) < 98) {
        failures.push("artefacts d'encodage dans le document final");
      }

      rows.push({
        offer: name,
        fidele: fB.pertinence, fideleBadge: fB.badge,
        optimise: oB.pertinence, optimiseBadge: oB.badge,
        decision: oB.optimizationDecision || "?",
        expected,
        failures,
      });
    } catch (e: any) {
      rows.push({ offer: name, fidele: -1, fideleBadge: "ERROR", optimise: -1, optimiseBadge: "ERROR", decision: "error", failures: [`pipeline error: ${e.message}`] });
    }
  }

  // ── Rapport ──
  console.log("\n" + "═".repeat(100));
  console.log("OFFRE".padEnd(24) + "FIDELE".padEnd(18) + "OPTIMISE".padEnd(18) + "DECISION".padEnd(22) + "BANDE".padEnd(12) + "VERDICT");
  console.log("─".repeat(100));
  let failCount = 0;
  for (const r of rows) {
    const band = r.expected ? `${r.expected.min}-${r.expected.max}` : "n/a";
    const verdict = r.failures.length === 0 ? "PASS" : `FAIL (${r.failures.length})`;
    if (r.failures.length > 0) failCount++;
    console.log(
      r.offer.slice(0, 22).padEnd(24)
      + `${r.fidele} ${r.fideleBadge}`.padEnd(18)
      + `${r.optimise} ${r.optimiseBadge}`.padEnd(18)
      + r.decision.padEnd(22)
      + band.padEnd(12)
      + verdict,
    );
    for (const f of r.failures) console.log(`    ✗ ${f}`);
  }
  console.log("═".repeat(100));
  console.log(`${rows.length - failCount}/${rows.length} offres dans les clous. CV et rapports: ${path.relative(ROOT, outDir)}`);
  fs.writeFileSync(path.join(outDir, "_summary.json"), JSON.stringify(rows, null, 2), "utf8");
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => fail(e.stack || e.message));

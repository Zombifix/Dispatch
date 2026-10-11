import { describe, it, expect } from "vitest";
import { runTailorPipeline, type TailorInput } from "../server/tailoring-engine";
import { exp, bullet } from "./fixtures";
import { fakeOpenAI } from "./fake-openai";

const PARSED_JOB = {
  title: "Senior UI Designer F/H", company: "Thales", seniority: "senior", domain: "Defense",
  requiredSkills: ["Figma", "Design System"], preferredSkills: ["Accessibility"], responsibilities: ["Designer des interfaces complexes"],
  keywords: ["Figma", "Design System", "Accessibility"], criticalKeywords: ["Figma", "Design System", "Accessibility"],
  language: "EN", intentions: ["structurer le design system"], positioning: "ic",
  roleFrame: { workObjects: ["interfaces complexes"], deliverables: ["maquettes"], decisions: [], collaborators: [], environments: [], scopeSignals: [] },
};

function responder(messages: any[]) {
  const system = String(messages[0]?.content || "");
  if (system.startsWith("Extract structured info")) return PARSED_JOB;
  if (system.startsWith("Score each CV bullet")) return { scores: [0, 1, 2, 3].map(i => ({ index: i, score: 45 })) };
  if (system.startsWith("Write a 2-3 sentence CV summary")) return "Designer produit qui conçoit des interfaces complexes.";
  if (system.startsWith("You make MINIMAL wording edits")) return { bullets: [], summary: "Designer produit centré sur les interfaces complexes et le design system." };
  if (system.startsWith("You are a strict hiring reviewer")) {
    const a = { pertinence: 70, fitMetier: 75, fitNiveau: "coherent", evidenceGrounding: 70, recruiterCredibilityScore: 72, atsReadiness: 70, overstatementRisk: 20, distanceDomain: "same", verdict: "ok", primaryDiagnosis: "Bon alignement global", whatMatches: [], whatMissing: [], nextActions: [], primaryCause: "strong_fit", secondaryCauses: [] };
    return { faithful: a, optimized: { ...a, recruiterCredibilityScore: 75 }, notes: [] };
  }
  return {};
}

const e1 = exp("e1", { title: "Product Designer", company: "Acme", description: "Plateforme B2B" });
const input: Omit<TailorInput, "mode"> = {
  jobText: "Senior UI Designer F/H chez Thales. ".repeat(20),
  allExperiences: [e1],
  allBullets: [
    bullet("b1", "e1", "Conçoit le design system Figma utilisé par 4 équipes produit de la plateforme", ["Design System", "Figma"]),
    bullet("b2", "e1", "Mène 20 entretiens utilisateurs pour refondre le parcours de commande B2B", ["User Research"]),
    bullet("b3", "e1", "Réduit de 30 % le temps de saisie des commandes grâce à un nouveau formulaire", ["Impact"]),
  ],
  allSkills: [{ id: "s1", userId: 1, name: "Figma", category: null, level: null, priority: 0, createdAt: new Date() }],
  profile: { name: "Alex Martin", title: "Product Designer senior", summary: "Product designer, 8 ans en B2B, je conçois des outils métier." },
};

describe("runTailorPipeline (faux modèle)", () => {
  for (const mode of ["original", "polished"] as const) {
    it(`mode ${mode} : titre et langue de l'utilisateur, aucune compétence ajoutée, retouches tracées`, async () => {
      const { client } = fakeOpenAI(responder);
      const r = await runTailorPipeline({ ...input, mode }, client);
      const lines = r.cvText.split("\n");
      expect(lines[0]).toBe("Alex Martin");
      expect(lines[1]).toBe("Product Designer senior");
      expect(r.cvText).not.toContain("F/H");
      expect(r.cvText).toContain("EXPERIENCE PROFESSIONNELLE"); // bibliothèque FR, offre EN
      expect(r.cvText).not.toMatch(/PROFESSIONAL SUMMARY|SKILLS:/);
      expect(r.structuredCV.skills).toEqual(["Figma"]);
      expect(r.report.cvLanguage).toBe("FR");
      expect(r.report.jobLanguage).toBe("EN");
      expect(r.report.tips[0]).toContain("ta bibliothèque");
      expect(Array.isArray(r.report.rewrites)).toBe(true);
      if (mode === "original") {
        expect(r.cvText).toContain("Product designer, 8 ans en B2B, je conçois des outils métier.");
        expect(r.report.rewrites).toEqual([]);
      }
      for (const rw of r.report.rewrites || []) expect(rw.original).not.toBe(rw.rewritten);
    });
  }
});

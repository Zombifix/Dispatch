import { describe, it, expect } from "vitest";
import { assembleCv, buildAssemblyReport, parseJobDeterministic, type AssemblyInput } from "../server/assembler";
import { lintCv } from "../server/cv-lint";
import { exp, bullet } from "./fixtures";
import type { BulletVariant, ProfileVariant } from "@shared/schema";

const e1 = exp("e1", { title: "Product Designer", company: "Acme", startDate: "2021-03-01", endDate: null });
const e2 = exp("e2", { title: "UX Designer", company: "Beta", startDate: "2017-01-01", endDate: "2021-02-01" });
const bullets = [
  bullet("b1", "e1", "Conçoit le design system Figma utilisé par 4 équipes produit de la plateforme", ["Design System", "Figma"]),
  bullet("b2", "e1", "Mène 20 entretiens utilisateurs pour refondre le parcours de commande B2B", ["User Research"]),
  bullet("b3", "e1", "Réduit de 30 % le temps de saisie des commandes grâce à un formulaire repensé", ["Impact"]),
  bullet("b4", "e2", "Anime des ateliers de co-conception avec les équipes métier et les développeurs", ["Atelier"]),
];
const variant = (bulletId: string, angle: string, language: string, text: string): BulletVariant =>
  ({ id: `${bulletId}-${angle}-${language}`, bulletId, angle, language, text, source: "user", updatedAt: new Date() });
const pv = (kind: string, angle: string, language: string, text: string): ProfileVariant =>
  ({ id: `${kind}-${angle}-${language}`, userId: 1, kind, angle, language, text, updatedAt: new Date() });

const OFFER_FR = `Lead Product Designer (H/F)
Vous serez le référent du design system et accompagnerez les équipes produit.
Compétences : Figma, Design System, User Research, accessibilité.`;

const base: AssemblyInput = {
  jobText: OFFER_FR,
  experiences: [e1, e2],
  bullets,
  bulletVariants: [
    variant("b1", "lead", "FR", "Structure le design system Figma et ses standards pour 4 équipes produit de la plateforme"),
    variant("b1", "ic", "EN", "Designed the Figma design system used by 4 product teams across the platform"),
  ],
  profileVariants: [pv("title", "lead", "FR", "Lead Product Designer"), pv("summary", "lead", "FR", "Je structure les pratiques design des équipes produit.")],
  skills: [
    { id: "s1", userId: 1, name: "Figma", category: null, level: null, priority: 0, createdAt: new Date() },
    { id: "s2", userId: 1, name: "Prototypage", category: null, level: null, priority: 1, createdAt: new Date() },
  ],
  profile: { name: "Alex Martin", title: "Product Designer", summary: "Product designer B2B." },
};

describe("parseJobDeterministic", () => {
  it("détecte langue, angle et exigences présentes dans le vocabulaire de l'utilisateur", () => {
    const job = parseJobDeterministic(OFFER_FR, ["Figma", "Design System", "Jira"]);
    expect(job.language).toBe("FR");
    expect(job.positioning).toBe("lead");
    expect(job.criticalKeywords).toEqual(expect.arrayContaining(["Figma"]));
    expect(job.criticalKeywords).not.toContain("Jira");
  });
  it("ne compte pas deux fois la même exigence et reconnaît les synonymes", () => {
    const job = parseJobDeterministic("Product designer. Design System, design system, recherche utilisateur.", ["Design System"]);
    const ds = job.criticalKeywords.filter(k => k.toLowerCase() === "design system");
    expect(ds).toHaveLength(1);
  });
  it("relie « entretiens utilisateurs » à la recherche utilisateur", async () => {
    const r = await assembleCv({ ...base, jobText: OFFER_FR + "\nRecherche utilisateur indispensable." }, null);
    expect(r.details.coverage.covered.map(k => k.toLowerCase())).toContain("recherche utilisateur");
  });
});

describe("assembleCv sans IA", () => {
  it("compose un CV uniquement à partir de textes de l'utilisateur", async () => {
    const r = await assembleCv(base, null);
    const userTexts = new Set([
      ...bullets.map(b => b.text), ...base.bulletVariants.map(v => v.text),
      ...base.profileVariants.map(v => v.text), base.profile!.title!, base.profile!.summary!,
    ]);
    for (const b of r.cv.experiences.flatMap(e => e.bullets)) expect(userTexts.has(b)).toBe(true);
    expect(userTexts.has(r.cv.summary)).toBe(true);
    expect(r.cv.skills.every(s => ["Figma", "Prototypage"].includes(s))).toBe(true);
    expect(r.details.jobReading).toBe("deterministe");
  });

  it("choisit l'angle de l'offre, le titre, le résumé et la formulation correspondants", async () => {
    const r = await assembleCv(base, null);
    expect(r.details.angle).toBe("lead");
    expect(r.cv.targetTitle).toBe("Lead Product Designer");
    expect(r.cv.summary).toBe("Je structure les pratiques design des équipes produit.");
    expect(r.cvText).toContain("Structure le design system Figma et ses standards");
    expect(r.cvText).not.toContain("H/F");
    const b1 = r.details.bullets.find(b => b.factId === "b1")!;
    expect(b1.variant).toBe("lead");
    expect(b1.reasons.join(" ")).toMatch(/couvre|mots de l'offre/);
  });

  it("est déterministe", async () => {
    const a = await assembleCv(base, null);
    const b = await assembleCv(base, null);
    expect(a.cvText).toBe(b.cvText);
  });

  it("respecte un angle forcé et signale les formulations manquantes", async () => {
    const r = await assembleCv({ ...base, angle: "consultant" }, null);
    expect(r.details.angle).toBe("consultant");
    expect(r.details.angleSource).toBe("choix");
    expect(r.details.missingVariants.length).toBeGreaterThan(0);
    expect(r.details.missingProfile).toEqual(expect.arrayContaining(["title", "summary"]));
    expect(r.cvText).toContain("Conçoit le design system Figma"); // phrase de base, pas la version lead
  });

  it("n'écrit en anglais que les faits qui ont une formulation anglaise", async () => {
    const r = await assembleCv({ ...base, language: "EN" }, null);
    expect(r.details.language).toBe("EN");
    expect(r.cvText).toContain("Designed the Figma design system");
    expect(r.cvText).not.toMatch(/Mène|Réduit|Anime/);
    expect(r.details.droppedForLanguage).toBe(3);
    expect(r.cvText).toContain("EXPERIENCE");
  });

  it("reste en français pour une offre anglaise si la bibliothèque n'a pas assez de formulations anglaises", async () => {
    const r = await assembleCv({ ...base, jobText: "Lead Product Designer. You will own the design system with Figma and drive user research across teams." }, null);
    expect(r.details.language).toBe("FR");
    expect(r.details.languageSource).toBe("bibliotheque");
    const report = buildAssemblyReport(r);
    expect(report.tips[0]).toContain("formulations EN");
  });

  it("produit un rapport compatible avec l'historique", async () => {
    const report = buildAssemblyReport(await assembleCv(base, null));
    expect(report.mode).toBe("assembly");
    expect(report.confidence).toBeGreaterThanOrEqual(0);
    expect(report.postRules.injectedKeywords).toEqual([]);
    expect(report.structuredCV.experiences.length).toBe(2);
  });
});

describe("lintCv", () => {
  it("signale formules creuses, verbes répétés et mélange de langues", () => {
    const issues = lintCv({
      targetTitle: "PD", summary: "Designer passionné et orienté résultats.",
      experiences: [{ title: "PD", company: "Acme", dates: "", bullets: [
        "Conçoit les parcours de la plateforme B2B pour 3 équipes",
        "Conçoit le design system avec les développeurs front",
        "Designed the onboarding flow for the mobile app and the team",
      ] }],
      skills: [], formations: [], languages: [],
    }, "FR");
    const rules = issues.map(i => i.rule);
    expect(rules).toEqual(expect.arrayContaining(["formule-creuse", "verbe-repete", "langue-melangee"]));
  });
  it("ne signale rien sur un CV sobre", () => {
    const issues = lintCv({
      targetTitle: "PD", summary: "Product designer B2B depuis 8 ans.",
      experiences: [{ title: "PD", company: "Acme", dates: "", bullets: [
        "Conçoit le design system utilisé par 4 équipes produit",
        "Mène 20 entretiens pour refondre le parcours de commande",
        "Réduit de 30 % le temps de saisie grâce à un nouveau formulaire",
      ] }],
      skills: [], formations: [], languages: [],
    }, "FR");
    expect(issues).toEqual([]);
  });
});

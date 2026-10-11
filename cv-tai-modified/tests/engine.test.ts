import { describe, it, expect } from "vitest";
import {
  deterministicScore, allocateCharBudget, selectBullets, applyPostRules, renderCVText,
  normalizeLinkedInUrl, repairMojibake, type ScoredBullet, type StructuredCV,
} from "../server/tailoring-engine";
import { exp, bullet, job } from "./fixtures";

function scored(b: ReturnType<typeof bullet>, e: ReturnType<typeof exp>, total: number, dimension = "craft"): ScoredBullet {
  return { bullet: b, experience: e, deterministicScore: total, llmScore: 0, semanticScore: 0, totalScore: total, matchedTags: [], matchedKeywords: [], dimension };
}

describe("normalizeLinkedInUrl", () => {
  it("extrait l'identifiant d'offre depuis currentJobId", () => {
    expect(normalizeLinkedInUrl("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4397046821&eBP=x"))
      .toBe("https://www.linkedin.com/jobs/view/4397046821");
  });
  it("laisse les autres domaines intacts", () => {
    expect(normalizeLinkedInUrl("https://jobs.example.com/a?b=1")).toBe("https://jobs.example.com/a?b=1");
  });
});

describe("repairMojibake", () => {
  it("répare un texte UTF-8 lu en latin-1", () => {
    expect(repairMojibake("expÃ©rience utilisateur")).toBe("expérience utilisateur");
  });
  it("ne touche pas un texte propre", () => {
    expect(repairMojibake("Réalisé à Paris – 2024")).toBe("Réalisé à Paris – 2024");
  });
});

describe("deterministicScore", () => {
  const e = exp("e1");
  it("récompense les tags et le texte qui couvrent les mots-clés", () => {
    const good = deterministicScore(bullet("b1", "e1", "Construit le design system Figma de 3 produits", ["Design System", "Figma"]), e, ["Figma", "Design System"], ["Figma"], []);
    const weak = deterministicScore(bullet("b2", "e1", "Participe aux réunions d'équipe", []), e, ["Figma", "Design System"], ["Figma"], []);
    expect(good.score).toBeGreaterThan(weak.score);
    expect(good.matchedKeywords).toContain("Figma");
  });
  it("est plafonné à 60", () => {
    const many = Array.from({ length: 30 }, (_, i) => `kw${i}`);
    const r = deterministicScore(bullet("b", "e1", many.join(" "), many), e, many, many, []);
    expect(r.score).toBeLessThanOrEqual(60);
  });
});

describe("allocateCharBudget", () => {
  it("donne plus de budget à l'expérience la plus pertinente et respecte le total", () => {
    const e1 = exp("e1", { endDate: null });
    const e2 = exp("e2", { startDate: "2015-01-01", endDate: "2017-01-01" });
    const s = [
      scored(bullet("a", "e1", "x".repeat(120)), e1, 90),
      scored(bullet("b", "e1", "x".repeat(120)), e1, 80),
      scored(bullet("c", "e2", "x".repeat(120)), e2, 20),
    ];
    const allocs = allocateCharBudget([e1, e2], s, 3500);
    const a1 = allocs.find(a => a.experience.id === "e1")!;
    const a2 = allocs.find(a => a.experience.id === "e2")!;
    expect(a1.charBudget).toBeGreaterThan(a2.charBudget);
    expect(allocs.every(a => a.maxBullets >= 1)).toBe(true);
  });
});

describe("selectBullets", () => {
  it("ne sélectionne jamais deux fois le même contenu entre expériences", () => {
    const e1 = exp("e1"); const e2 = exp("e2", { endDate: "2020-01-01" });
    const text = "Conçoit le design system Figma utilisé par 4 équipes produit";
    const s = [
      scored(bullet("a", "e1", text, ["Design System"]), e1, 90),
      scored(bullet("b", "e2", text, ["Design System"]), e2, 89),
    ];
    const allocs = allocateCharBudget([e1, e2], s, 3500);
    const sel = selectBullets(s, allocs, job());
    const all = sel.flatMap(x => x.selectedBullets.map(sb => sb.bullet.text));
    expect(new Set(all).size).toBe(all.length);
  });
  it("respecte le nombre maximal de bullets par expérience", () => {
    const e1 = exp("e1");
    const s = Array.from({ length: 8 }, (_, i) => scored(bullet(`b${i}`, "e1", `Livre la fonctionnalité ${i} pour ${i + 2} équipes Figma design system`, ["Figma"]), e1, 95 - i));
    const allocs = allocateCharBudget([e1], s, 2000);
    const sel = selectBullets(s, allocs, job());
    expect(sel[0].selectedBullets.length).toBeLessThanOrEqual(allocs[0].maxBullets);
  });
});

describe("applyPostRules", () => {
  const cv = (): StructuredCV => ({
    targetTitle: "Product Designer", summary: "Designer produit.",
    experiences: [{ title: "PD", company: "Acme", dates: "2021 - Present", bullets: ["Conçoit le design system Figma", "y".repeat(230)] }],
    skills: ["Figma"], formations: [], languages: [],
  });
  it("tronque les bullets trop longs à 200 caractères", () => {
    const c = cv();
    const r = applyPostRules(c, job());
    expect(c.experiences[0].bullets.every(b => b.length <= 200)).toBe(true);
    expect(r.longBullets).toBe(1);
  });
  it("mesure la couverture des mots-clés critiques", () => {
    const r = applyPostRules(cv(), job());
    expect(r.keywordsCovered).toEqual(expect.arrayContaining(["Figma", "Design System"]));
  });
});

describe("renderCVText", () => {
  it("rend les sections dans la langue de l'offre", () => {
    const text = renderCVText({
      name: "Alex", targetTitle: "Product Designer", summary: "Résumé.",
      experiences: [{ title: "PD", company: "Acme", dates: "janv. 2021 - Present", bullets: ["Fait A"] }],
      skills: ["Figma"], formations: [], languages: [],
    }, job({ language: "FR" }));
    expect(text).toContain("EXPERIENCE PROFESSIONNELLE");
    expect(text).toContain("- Fait A");
    expect(text.split("\n")[0]).toBe("Alex");
  });
});

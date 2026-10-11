import { describe, it, expect } from "vitest";
import {
  validateRewrite, detectLanguage, revertRewrite, composeCVDocument, buildStructuredCV, applyPostRules,
  renderCV, type StructuredCV, type ScoredExperience,
} from "../server/tailoring-engine";
import { exp, bullet, job } from "./fixtures";
import { fakeOpenAI } from "./fake-openai";

const ORIGINAL = "Anime des ateliers avec 3 équipes produit pour définir les composants Figma partagés";

function baseCv(): StructuredCV {
  return {
    name: "Alex", targetTitle: "Product Designer", summary: "Mon résumé à moi.",
    experiences: [{ title: "PD", company: "Acme", dates: "2021 - Present", bullets: [ORIGINAL, "Conçoit le parcours de paiement mobile de l'application"] }],
    skills: ["Figma"], formations: [], languages: [],
  };
}

describe("validateRewrite", () => {
  it("accepte un changement de vocabulaire minimal", () => {
    expect(validateRewrite(ORIGINAL, "Anime des ateliers avec 3 équipes produit pour définir le design system Figma partagé", "design system").ok).toBe(true);
  });
  it("refuse un chiffre ajouté", () => {
    expect(validateRewrite(ORIGINAL, "Anime des ateliers avec 3 équipes produit pour définir 40 composants Figma partagés").ok).toBe(false);
  });
  it("refuse un chiffre perdu", () => {
    expect(validateRewrite(ORIGINAL, "Anime des ateliers avec plusieurs équipes produit pour définir les composants Figma partagés").ok).toBe(false);
  });
  it("refuse un nom propre inventé", () => {
    expect(validateRewrite(ORIGINAL, "Anime des ateliers avec 3 équipes produit de Google pour définir les composants Figma").ok).toBe(false);
  });
  it("refuse une réécriture complète", () => {
    expect(validateRewrite(ORIGINAL, "Pilote la stratégie design de 3 équipes en structurant une gouvernance Figma ambitieuse").ok).toBe(false);
  });
});

describe("detectLanguage", () => {
  it("reconnaît une bibliothèque en français ou en anglais", () => {
    expect(detectLanguage(["Conçoit la refonte du parcours pour les équipes"])).toBe("FR");
    expect(detectLanguage(["Designed the checkout flow and led the research with the team"])).toBe("EN");
  });
});

describe("composeCVDocument", () => {
  it("ne touche que les bullets désignés, rejette les inventions et trace les retouches", async () => {
    const { client } = fakeOpenAI(() => ({
      bullets: [
        { index: 0, text: "Anime des ateliers avec 3 équipes produit pour définir le design system Figma partagé" },
        { index: 1, text: "Conçoit le parcours de paiement mobile utilisé par 2 millions de clients" },
      ],
      summary: "Product designer qui structure le design system avec les équipes produit.",
    }));
    const cv = await composeCVDocument(baseCv(), job(), client, {
      candidates: [{ experienceIndex: 0, bulletIndex: 0, reason: "test" }, { experienceIndex: 0, bulletIndex: 1, reason: "test" }],
      rewriteSummary: true,
    });
    expect(cv.experiences[0].bullets[0]).toContain("design system");
    expect(cv.experiences[0].bullets[1]).toBe("Conçoit le parcours de paiement mobile de l'application"); // chiffre inventé : rejeté
    expect(cv.rewrites?.map(r => r.target)).toEqual(["bullet", "summary"]);
  });

  it("conserve le texte de l'utilisateur si le modèle échoue", async () => {
    const { client } = fakeOpenAI(() => { throw new Error("panne"); });
    const cv = await composeCVDocument(baseCv(), job(), client, { candidates: [{ experienceIndex: 0, bulletIndex: 0, reason: "t" }], rewriteSummary: true });
    expect(cv.experiences[0].bullets[0]).toBe(ORIGINAL);
    expect(cv.summary).toBe("Mon résumé à moi.");
    expect(cv.rewrites).toEqual([]);
  });

  it("n'appelle pas le modèle quand rien n'est à retoucher", async () => {
    const { client, calls } = fakeOpenAI(() => ({}));
    await composeCVDocument(baseCv(), job(), client, { candidates: [], rewriteSummary: false });
    expect(calls.length).toBe(0);
  });
});

describe("revertRewrite", () => {
  it("rétablit la formulation d'origine", () => {
    const cv = baseCv();
    cv.experiences[0].bullets[0] = "Version IA";
    cv.rewrites = [{ target: "bullet", experienceIndex: 0, bulletIndex: 0, original: ORIGINAL, rewritten: "Version IA", reason: "t" }];
    const back = revertRewrite(cv, 0);
    expect(back.experiences[0].bullets[0]).toBe(ORIGINAL);
    expect(back.rewrites?.[0].reverted).toBe(true);
    expect(cv.experiences[0].bullets[0]).toBe("Version IA"); // pas de mutation de l'entrée
  });
});

describe("buildStructuredCV", () => {
  const e = exp("e1", { title: "Product Designer" });
  const selExps: ScoredExperience[] = [{
    experience: e, score: 80, reason: "", matchedAspects: [], charBudget: 1000,
    selectedBullets: [{ bullet: bullet("b1", "e1", ORIGINAL), experience: e, deterministicScore: 40, llmScore: 40, semanticScore: 20, totalScore: 100, matchedTags: [], matchedKeywords: [], dimension: "craft" }],
  }];

  it("utilise le titre de l'utilisateur, jamais celui de l'offre", async () => {
    const { client } = fakeOpenAI(() => "Résumé généré.");
    const cv = await buildStructuredCV(job({ title: "Senior UI Designer F/H" }), selExps, [], "original", client, { profileTitle: "Lead Product Designer", profileSummary: "Mon résumé." });
    expect(cv.targetTitle).toBe("Lead Product Designer");
  });

  it("reprend le résumé de l'utilisateur tel quel en mode fidèle, sans appel IA", async () => {
    const { client, calls } = fakeOpenAI(() => "Résumé généré.");
    const cv = await buildStructuredCV(job(), selExps, [], "original", client, { profileTitle: "PD", profileSummary: "Mon résumé." });
    expect(cv.summary).toBe("Mon résumé.");
    expect(cv.summarySource).toBe("profile");
    expect(calls.length).toBe(0);
  });

  it("sans titre de profil, reprend l'intitulé de l'expérience principale", async () => {
    const { client } = fakeOpenAI(() => "Résumé généré.");
    const cv = await buildStructuredCV(job({ title: "Senior UI Designer F/H" }), selExps, [], "original", client, {});
    expect(cv.targetTitle).toBe("Product Designer");
  });
});

describe("applyPostRules", () => {
  it("n'ajoute aucune compétence absente de la bibliothèque", () => {
    const cv = baseCv();
    const r = applyPostRules(cv, job({ criticalKeywords: ["Figma", "Accessibility", "Design Tokens"] }));
    expect(cv.skills).toEqual(["Figma"]);
    expect(r.injectedKeywords).toEqual([]);
    expect(r.keywordsMissing).toEqual(expect.arrayContaining(["Accessibility", "Design Tokens"]));
  });
});

describe("renderCV", () => {
  it("rend une seule langue d'en-têtes", () => {
    const en = renderCV(baseCv(), "EN");
    expect(en).toContain("EXPERIENCE");
    expect(en).not.toContain("EXPERIENCE PROFESSIONNELLE");
  });
});

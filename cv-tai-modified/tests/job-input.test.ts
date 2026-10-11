import { describe, it, expect } from "vitest";
import { sanitizeJobText, assessJobTextQuality, extractJsonLdJobPosting, isBlockedScrapeText } from "../server/job-input";

const OFFER = `Gestion des cookies
Se connecter
Description du poste
Vos missions : concevoir les parcours utilisateurs du produit, faire évoluer le design system.
Profil recherché : 5 ans d'expérience en product design, maîtrise de Figma, user research.
Vous serez rattaché au Head of Design et travaillerez avec les équipes produit et tech.
Responsabilités : prototypage, tests utilisateurs, accessibilité, collaboration avec les PM.
Postuler`;

describe("sanitizeJobText", () => {
  it("coupe le bruit avant la description et retire la navigation", () => {
    const t = sanitizeJobText(OFFER);
    expect(t.startsWith("Description du poste")).toBe(true);
    expect(t).not.toMatch(/^Postuler$/m);
    expect(t).not.toMatch(/Gestion des cookies/);
  });
  it("limite la taille à 8000 caractères", () => {
    expect(sanitizeJobText("Description du poste\n" + "mission ".repeat(3000)).length).toBeLessThanOrEqual(8000);
  });
});

describe("assessJobTextQuality", () => {
  it("accepte une vraie annonce", () => {
    const r = assessJobTextQuality(sanitizeJobText(OFFER) + "\n" + "Contexte : équipe produit de 40 personnes, SaaS B2B. ".repeat(10));
    expect(r.ok).toBe(true);
  });
  it("refuse un formulaire de candidature", () => {
    const r = assessJobTextQuality("Postuler\nVotre CV\nLettre de motivation\nPrénom *\nNom *\nEmail *\nTéléphone *\nUpload your CV\n".repeat(5));
    expect(r.ok).toBe(false);
  });
  it("refuse un texte trop court", () => {
    expect(assessJobTextQuality("Designer").ok).toBe(false);
  });
});

describe("extractJsonLdJobPosting", () => {
  it("lit une offre schema.org JobPosting", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting", title: "Product Designer", hiringOrganization: { name: "Acme" },
      description: "<p>Concevoir les parcours.</p><ul><li>Figma</li></ul>" + "<p>Détail.</p>".repeat(30),
    })}</script>`;
    const t = extractJsonLdJobPosting(html)!;
    expect(t).toContain("# Product Designer");
    expect(t).toContain("Company: Acme");
    expect(t).not.toContain("<p>");
  });
});

describe("isBlockedScrapeText", () => {
  it("détecte une page anti-bot", () => {
    expect(isBlockedScrapeText("Just a moment... Checking your browser")).toBe(true);
    expect(isBlockedScrapeText("Description du poste : Product Designer")).toBe(false);
  });
});

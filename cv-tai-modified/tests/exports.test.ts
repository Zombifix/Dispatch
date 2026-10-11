import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { toDocx, toJsonResume, toFigmaPayload, safeFileName } from "../server/exports";
import type { StructuredCV } from "../server/tailoring-engine";

const CV: StructuredCV = {
  name: "Alex Martin", targetTitle: "Lead Product Designer", summary: "Je structure les pratiques design.",
  experiences: [{ title: "Product Designer", company: "Acme", dates: "mars 2021 - Aujourd'hui", bullets: ["Conçoit le design system & les composants <Figma>"] }],
  skills: ["Figma"], formations: [{ degree: "Master", school: "Strate", year: "2016" }], languages: [{ name: "Anglais", level: "C1" }],
};

describe("exports", () => {
  it("produit un DOCX une colonne avec le texte réel (lisible par un ATS)", async () => {
    const buf = await toDocx(CV, "FR");
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("Alex Martin");
    expect(xml).toContain("Conçoit le design system &amp; les composants &lt;Figma&gt;");
    expect(xml).toContain("EXPÉRIENCE PROFESSIONNELLE");
    expect(xml).not.toContain("<w:tbl>"); // pas de tableau
  });
  it("produit un JSON Resume et un format Figma cohérents", () => {
    expect(toJsonResume(CV, "EN").work[0].highlights).toEqual(CV.experiences[0].bullets);
    const f = toFigmaPayload(CV, "EN");
    expect(f.labels.experience).toBe("Experience");
    expect(f.version).toBe(1);
  });
  it("nettoie les noms de fichier", () => {
    expect(safeFileName("Alex Martin", "Société Générale / Paris")).toBe("Alex-Martin-Societe-Generale-Paris");
    expect(safeFileName("Alex", "Lead Product Designer (H/F)")).toBe("Alex-Lead-Product-Designer");
  });
});

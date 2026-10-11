import { describe, it, expect } from "vitest";
import { validateVariant, pickVariantText } from "../server/engine/variants";

const BASE = "Conçoit le design system Figma utilisé par 4 équipes produit de la plateforme";

describe("validateVariant", () => {
  it("accepte une traduction fidèle", () => {
    expect(validateVariant(BASE, "Designed the Figma design system used by 4 product teams across the platform").ok).toBe(true);
  });
  it("accepte un autre angle sans ajout", () => {
    expect(validateVariant(BASE, "Structure les standards du design system Figma partagés par 4 équipes produit").ok).toBe(true);
  });
  it("refuse un chiffre modifié ou ajouté", () => {
    expect(validateVariant(BASE, "Conçoit le design system Figma utilisé par 6 équipes produit de la plateforme").ok).toBe(false);
    expect(validateVariant(BASE, "Conçoit le design system Figma utilisé par 4 équipes produit et 200 utilisateurs").ok).toBe(false);
  });
  it("refuse un outil perdu ou ajouté", () => {
    expect(validateVariant(BASE, "Conçoit le design system utilisé par 4 équipes produit de toute la plateforme").ok).toBe(false);
    expect(validateVariant(BASE, "Conçoit le design system Figma et Storybook utilisé par 4 équipes produit").ok).toBe(false);
  });
  it("refuse un nom propre absent du fait", () => {
    expect(validateVariant(BASE, "Conçoit le design system Figma utilisé par 4 équipes produit chez Google").ok).toBe(false);
  });
});

describe("pickVariantText", () => {
  const variants = [
    { bulletId: "b", angle: "lead", language: "FR", text: "Version lead FR" },
    { bulletId: "b", angle: "ic", language: "EN", text: "IC version EN" },
  ];
  it("prend la formulation exacte quand elle existe", () => {
    expect(pickVariantText(BASE, "FR", variants, "lead", "FR")).toEqual({ text: "Version lead FR", angle: "lead", exact: true });
  });
  it("retombe sur la formulation ic de la langue, puis sur la phrase de base (jamais un autre angle qui pourrait survendre)", () => {
    expect(pickVariantText(BASE, "FR", variants, "lead", "EN")?.text).toBe("IC version EN");
    expect(pickVariantText(BASE, "FR", variants, "consultant", "FR")?.text).toBe(BASE);
  });
  it("utilise le texte de base dans sa langue", () => {
    expect(pickVariantText(BASE, "FR", [], "ic", "FR")).toEqual({ text: BASE, angle: "base", exact: true });
  });
  it("ne traduit jamais : null si aucune formulation dans la langue", () => {
    expect(pickVariantText(BASE, "FR", [], "ic", "EN")).toBeNull();
  });
});

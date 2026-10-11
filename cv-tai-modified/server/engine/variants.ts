import type { Angle, CvLanguage } from "@shared/schema";
import { normalizeEvidenceText } from "./text";

// Outils et marques dont la présence doit être conservée dans toute formulation.
const KNOWN_TOOLS = [
  "figma", "sketch", "miro", "notion", "jira", "confluence", "hotjar", "mixpanel", "amplitude", "maze",
  "usertesting", "airtable", "invision", "zeplin", "framer", "webflow", "react", "vue", "angular",
  "storybook", "contentful", "wordpress", "shopify", "salesforce", "hubspot", "intercom", "dovetail",
  "lookback", "productboard", "pendo", "fullstory", "contentsquare",
];

export const ANGLE_LABELS: Record<Angle, string> = {
  ic: "Craft / delivery",
  lead: "Lead / vision",
  consultant: "Conseil / accompagnement",
  manager: "Management",
};

function numbers(text: string): string[] {
  return (text.match(/\d[\d\s,.]*%?/g) || []).map(n => n.replace(/\s+/g, "").replace(/[.,]$/, "")).sort();
}

/**
 * Vérifie qu'une formulation dit la même chose que le fait d'origine :
 * mêmes chiffres, mêmes outils, aucun nom propre nouveau. La langue peut changer.
 */
export function validateVariant(base: string, variant: string, opts: { allowedVocabulary?: string } = {}): { ok: boolean; reason?: string } {
  const v = variant.trim();
  if (v.length < 40 || v.length > 220) return { ok: false, reason: "longueur hors limites (40-220)" };
  if (numbers(base).join("|") !== numbers(v).join("|")) return { ok: false, reason: "les chiffres doivent être identiques à ceux du fait" };
  const baseLow = base.toLowerCase();
  const vLow = v.toLowerCase();
  const lostTool = KNOWN_TOOLS.find(t => baseLow.includes(t) && !vLow.includes(t));
  if (lostTool) return { ok: false, reason: `outil perdu (${lostTool})` };
  const addedTool = KNOWN_TOOLS.find(t => vLow.includes(t) && !baseLow.includes(t));
  if (addedTool) return { ok: false, reason: `outil ajouté (${addedTool})` };
  const known = normalizeEvidenceText(`${base} ${opts.allowedVocabulary || ""}`);
  const words = v.match(/\b[A-Z][A-Za-z0-9À-ÿ]{2,}\b/g) || [];
  const newProper = words
    .filter((w, i) => !(i === 0 && v.startsWith(w)))
    .filter(w => !known.includes(normalizeEvidenceText(w)));
  if (newProper.length > 0) return { ok: false, reason: `nom propre absent du fait (${newProper[0]})` };
  return { ok: true };
}

export type VariantLike = { bulletId: string; angle: string; language: string; text: string };

/**
 * Choisit la formulation d'un fait pour un CV : angle et langue demandés,
 * sinon même langue angle "ic", sinon n'importe quel angle dans la langue,
 * sinon le texte de base s'il est dans la bonne langue. null = aucune
 * formulation dans cette langue (le fait est alors signalé, jamais traduit en douce).
 */
export function pickVariantText(
  baseText: string,
  baseLanguage: CvLanguage,
  variants: VariantLike[],
  angle: Angle,
  language: CvLanguage,
): { text: string; angle: Angle | "base"; exact: boolean } | null {
  const inLang = variants.filter(v => v.language === language);
  const exact = inLang.find(v => v.angle === angle);
  if (exact) return { text: exact.text, angle, exact: true };
  const ic = inLang.find(v => v.angle === "ic");
  if (ic) return { text: ic.text, angle: "ic", exact: false };
  if (baseLanguage === language) return { text: baseText, angle: "base", exact: angle === "ic" };
  const any = inLang[0];
  if (any) return { text: any.text, angle: any.angle as Angle, exact: false };
  return null;
}

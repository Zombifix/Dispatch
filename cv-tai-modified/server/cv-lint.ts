import type { StructuredCV } from "./tailoring-engine";

/**
 * Linter anti-CV générique : règles déterministes, sans IA.
 * Il signale ce qu'un recruteur lit comme "écrit par une machine" ou comme du
 * remplissage. Il ne modifie rien : c'est l'utilisateur qui décide.
 */
export type LintSeverity = "warning" | "info";
export interface LintIssue {
  rule: string;
  severity: LintSeverity;
  message: string;
  excerpt?: string;
}

// Formules creuses fréquentes, en français et en anglais.
const HOLLOW_PHRASES = [
  "results-driven", "results driven", "dynamic professional", "passionate", "team player", "self-starter",
  "go-getter", "detail-oriented", "proven track record", "spearheaded", "leveraged", "synergy", "synergies",
  "thought leader", "best-in-class", "cutting-edge", "game-changer", "operational efficiency", "fast-paced",
  "orienté résultats", "force de proposition", "dynamique et motivé", "passionné", "esprit d'équipe",
  "fort de", "forte de", "au service de", "avec succès", "pilotage avec succès", "véritable", "incontournable",
  "valeur ajoutée", "de bout en bout", "à forte valeur",
];

const FR_STOP = /\b(le|la|les|des|du|une|et|pour|avec|dans|sur)\b/gi;
const EN_STOP = /\b(the|and|for|with|in|on|of|to)\b/gi;

function firstWord(text: string): string {
  return (text.trim().match(/^[\p{L}'-]+/u)?.[0] || "").toLowerCase();
}

function lang(text: string): "FR" | "EN" | null {
  const fr = (text.match(FR_STOP) || []).length;
  const en = (text.match(EN_STOP) || []).length;
  if (fr + en < 3) return null;
  return fr >= en ? "FR" : "EN";
}

export function lintCv(cv: StructuredCV, expectedLanguage: "FR" | "EN"): LintIssue[] {
  const issues: LintIssue[] = [];
  const bullets = cv.experiences.flatMap(e => e.bullets);
  const allText = [cv.summary, ...bullets].filter(Boolean);

  // 1. Formules creuses
  for (const text of allText) {
    const low = text.toLowerCase();
    const hit = HOLLOW_PHRASES.find(p => low.includes(p));
    if (hit) {
      issues.push({ rule: "formule-creuse", severity: "warning", message: `Formule creuse « ${hit} » : remplace-la par un fait.`, excerpt: text });
    }
  }

  // 2. Même verbe en tête de bullets proches
  for (const exp of cv.experiences) {
    for (let i = 1; i < exp.bullets.length; i++) {
      const w = firstWord(exp.bullets[i]);
      if (w && w.length > 2 && w === firstWord(exp.bullets[i - 1])) {
        issues.push({ rule: "verbe-repete", severity: "info", message: `Deux bullets de suite commencent par « ${w} » (${exp.company}).`, excerpt: exp.bullets[i] });
      }
    }
  }

  // 3. Longueurs trop uniformes (signature typique d'un texte généré)
  if (bullets.length >= 5) {
    const lengths = bullets.map(b => b.length);
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const sd = Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length);
    if (sd / mean < 0.12) {
      issues.push({ rule: "longueurs-uniformes", severity: "info", message: "Tous les bullets ont presque la même longueur : le CV peut paraître mécanique." });
    }
  }

  // 4. Preuves chiffrées
  if (bullets.length >= 3) {
    const withNumbers = bullets.filter(b => /\d/.test(b)).length;
    if (withNumbers / bullets.length < 0.3) {
      issues.push({ rule: "peu-de-preuves", severity: "info", message: `Seulement ${withNumbers} bullet(s) sur ${bullets.length} contiennent un chiffre (échelle, résultat, volume).` });
    }
  }

  // 5. Mélange de langues
  for (const text of allText) {
    const l = lang(text);
    if (l && l !== expectedLanguage) {
      issues.push({ rule: "langue-melangee", severity: "warning", message: `Phrase en ${l === "FR" ? "français" : "anglais"} dans un CV en ${expectedLanguage === "FR" ? "français" : "anglais"}.`, excerpt: text });
    }
  }

  // 6. Doublons de contenu
  const seen = new Map<string, string>();
  for (const b of bullets) {
    const key = b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").slice(0, 8).join(" ");
    if (key.length > 20 && seen.has(key)) {
      issues.push({ rule: "doublon", severity: "warning", message: "Deux bullets racontent la même chose.", excerpt: b });
    }
    seen.set(key, b);
  }

  // 7. Résumé trop long, tirets cadratins en série
  if (cv.summary && cv.summary.split(/[.!?](\s|$)/).filter(s => s.trim().length > 3).length > 3) {
    issues.push({ rule: "resume-long", severity: "info", message: "Le résumé dépasse 3 phrases : un recruteur le lit en 5 secondes." });
  }
  const dashes = allText.join(" ").match(/—/g)?.length || 0;
  if (dashes >= 3) {
    issues.push({ rule: "tirets", severity: "info", message: `${dashes} tirets cadratins : tic d'écriture souvent associé aux textes générés.` });
  }

  return issues;
}

// Utilitaires de texte du moteur : normalisation, réparation d'encodage,
// alias de mots-clés, détection de langue. Fonctions pures, sans dépendance.

export function normalizeEvidenceText(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type KeywordAliasGroup = {
  key: string;
  labels: { FR: string; EN: string };
  variants: string[];
};

export const KEYWORD_ALIAS_GROUPS: KeywordAliasGroup[] = [
  {
    key: "user_research",
    labels: { FR: "recherche utilisateur", EN: "user research" },
    variants: ["user research", "recherche utilisateur", "tests utilisateurs", "test utilisateur", "usability testing", "user interviews", "interviews utilisateurs", "entretiens utilisateurs", "entretien utilisateur", "ux research"],
  },
  {
    key: "design_system",
    labels: { FR: "design system", EN: "design system" },
    variants: ["design system", "systeme de design", "design systems"],
  },
  {
    key: "ui_design",
    labels: { FR: "design d'interface", EN: "UI design" },
    variants: ["design d'interface", "ui design", "ux/ui design", "interface design", "interfaces utilisateurs", "user interface design"],
  },
  {
    key: "interaction_design",
    labels: { FR: "interaction design", EN: "interaction design" },
    variants: ["interaction design", "user flows", "user flow", "parcours utilisateurs", "experience interactive", "experience d evaluation interactive"],
  },
  {
    key: "prototyping",
    labels: { FR: "prototypage", EN: "prototyping" },
    variants: ["prototyping", "prototype", "prototypes", "wireframes", "wireframing", "maquettes haute fidelite", "high fidelity mockups", "mockups"],
  },
  {
    key: "accessibility",
    labels: { FR: "accessibilite", EN: "accessibility" },
    variants: ["accessibilite", "accessibility", "inclusive design", "accessible design"],
  },
  {
    key: "design_strategy",
    labels: { FR: "strategie design", EN: "design strategy" },
    variants: ["design strategy", "strategie design", "product experience strategy", "design maturity"],
  },
  {
    key: "product_design",
    labels: { FR: "product design", EN: "product design" },
    variants: ["product design", "designer produit", "product designer"],
  },
  {
    key: "cross_functional_collaboration",
    labels: { FR: "collaboration transverse", EN: "cross-functional collaboration" },
    variants: ["cross-functional collaboration", "collaboration transverse", "product managers engineers", "equipes produit tech"],
  },
  {
    key: "adobe_substance",
    labels: { FR: "Adobe Substance", EN: "Adobe Substance" },
    variants: ["adobe substance", "substance 3d", "adobe substance 3d"],
  },
  {
    key: "3d_ecosystem",
    labels: { FR: "ecosysteme 3D", EN: "3D ecosystem" },
    variants: ["3d creatives", "3d immersive", "3d ecosystem", "3d industry", "3d tools", "3d initiatives"],
  },
];

export function findKeywordAliasGroup(value: string): KeywordAliasGroup | undefined {
  const normalized = normalizeEvidenceText(value);
  if (!normalized) return undefined;
  return KEYWORD_ALIAS_GROUPS.find(group =>
    group.variants.some(variant => {
      const candidate = normalizeEvidenceText(variant);
      return normalized === candidate || normalized.includes(candidate) || candidate.includes(normalized);
    }),
  );
}

export function keywordDisplayLabel(value: string, language: "FR" | "EN"): string {
  const group = findKeywordAliasGroup(value);
  return group ? group.labels[language] : value.trim();
}

export function keywordVariants(value: string): string[] {
  const group = findKeywordAliasGroup(value);
  return uniqueItems(group ? [...group.variants, group.labels.FR, group.labels.EN] : [value]);
}

export function textHasKeyword(text: string, keyword: string): boolean {
  const normalizedText = normalizeEvidenceText(text);
  if (!normalizedText) return false;
  return keywordVariants(keyword).some(variant => {
    const normalizedVariant = normalizeEvidenceText(variant);
    return normalizedVariant.length >= 3 && normalizedText.includes(normalizedVariant);
  });
}

export function isNoisyCriticalKeyword(value: string): boolean {
  const normalized = normalizeEvidenceText(value);
  const words = normalized.split(" ").filter(Boolean);
  if (!normalized || words.length === 0) return true;
  if (words.length > 4) return true;
  if (normalized.length < 3) return true;
  return /\b(degree|diploma|bachelor|master|phd|school|equivalent practical experience|years? experience|written communication|verbal communication|interpersonal|continuous learning|curiosity|storytelling|portfolio|status quo)\b/.test(normalized);
}

export function extractAliasConceptsFromText(parts: string[], language: "FR" | "EN"): string[] {
  const found: string[] = [];
  for (const part of parts) {
    const normalized = normalizeEvidenceText(part);
    for (const group of KEYWORD_ALIAS_GROUPS) {
      if (group.variants.some(variant => normalized.includes(normalizeEvidenceText(variant)))) {
        found.push(group.labels[language]);
      }
    }
  }
  return uniqueItems(found);
}


export function uniqueItems(items: string[]): string[] {
  return [...new Set(items.map(item => item?.trim()).filter(Boolean))];
}

export const MOJIBAKE_SIGNAL_RE = /(Ã.|Â.|â€|â€™|â€œ|â€“|â€”|â€¦|ðŸ|�)/;

export function mojibakePenaltyScore(value: string): number {
  if (!value) return 0;
  return (
    (value.match(/Ã./g) || []).length * 3
    + (value.match(/Â./g) || []).length * 2
    + (value.match(/â[-¿]/g) || []).length * 3
    + (value.match(/ðŸ/g) || []).length * 4
    + (value.match(/�/g) || []).length * 4
    + (value.match(/[\u0000-\u0008\u000B-\u0012\u0014-\u001F\u007F]/g) || []).length * 4
  );
}

export function applyCommonEncodingFixes(value: string): string {
  return (value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/(\d)[\u0011-\u001F](\d)/g, "$1-$2")
    .replace(/â€™/g, "’")
    .replace(/â€˜/g, "‘")
    .replace(/â€œ/g, "“")
    .replace(/â€|â€�/g, "”")
    .replace(/â€“/g, "–")
    .replace(/â€”/g, "—")
    .replace(/â€¦/g, "…")
    .replace(/Â/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[\u0000-\u0008\u000B-\u0012\u0014-\u001F\u007F]/g, "");
}

export function maybeDecodeLatin1AsUtf8(value: string): string {
  try {
    return Buffer.from(value, "latin1").toString("utf8");
  } catch {
    return value;
  }
}

export function repairMojibake(value: string): string {
  if (!value) return value;
  let best = applyCommonEncodingFixes(value);
  let bestScore = mojibakePenaltyScore(best);

  if (MOJIBAKE_SIGNAL_RE.test(value) || bestScore > 0) {
    const decodedOnce = applyCommonEncodingFixes(maybeDecodeLatin1AsUtf8(value));
    const decodedTwice = applyCommonEncodingFixes(maybeDecodeLatin1AsUtf8(decodedOnce));
    for (const candidate of [decodedOnce, decodedTwice]) {
      const score = mojibakePenaltyScore(candidate);
      if (score < bestScore || (score === bestScore && candidate.length > best.length)) {
        best = candidate;
        bestScore = score;
      }
    }
  }

  return best;
}

export function sanitizeTextValue(value: any): string {
  return repairMojibake(String(value ?? ""));
}

export function sanitizeOptionalTextValue(value: any): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return sanitizeTextValue(value);
}

export function sanitizeTextList(values: string[] | undefined): string[] {
  return uniqueItems((values || []).map(sanitizeTextValue));
}

// Tools spécifiques qui ne doivent pas peser autant qu'une compétence structurante dans l'evidence score
export const SPECIFIC_TOOL_KEYWORDS: Set<string> = new Set([
  "hotjar", "mixpanel", "amplitude", "heap", "fullstory", "contentsquare",
  "miro", "notion", "jira", "confluence", "asana", "trello", "basecamp",
  "sketch", "invision", "zeplin", "abstract", "principle", "flinto",
  "maze", "usertesting", "lookback", "dovetail", "userlytics",
  "airtable", "productboard", "canny", "pendo",
  "powerpoint", "keynote", "excel", "google slides",
]);

export function isSpecificToolKeyword(kw: string): boolean {
  const norm = normalizeEvidenceText(kw);
  return SPECIFIC_TOOL_KEYWORDS.has(norm) || [...SPECIFIC_TOOL_KEYWORDS].some(tool => norm === tool);
}

// ─── Langue ─────────────────────────────────────────────────────────────────
export const FR_MARKERS = /\b(le|la|les|des|du|une|un|et|pour|avec|sur|dans|chez|équipe|equipe|conçu|mise|refonte|accompagn|pilot)\b/gi;
export const EN_MARKERS = /\b(the|and|for|with|on|in|of|team|designed|led|built|delivered|improved|across)\b/gi;

/** Langue dominante d'un ensemble de textes (bibliothèque de l'utilisateur). */
export function detectLanguage(texts: string[]): "FR" | "EN" {
  const corpus = texts.join(" ");
  const fr = (corpus.match(FR_MARKERS) || []).length + (corpus.match(/[éèàùçê]/g) || []).length * 0.5;
  const en = (corpus.match(EN_MARKERS) || []).length;
  return en > fr ? "EN" : "FR";
}

/** Dédoublonne des libellés équivalents (casse, accents, alias : « Design System » = « design system »). */
export function dedupeKeywords(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = findKeywordAliasGroup(item)?.key || normalizeEvidenceText(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

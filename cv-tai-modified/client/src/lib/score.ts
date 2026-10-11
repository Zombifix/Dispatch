/**
 * Single source of truth for score colours — shared by Historique and Résultat so the same run
 * never reads green on one screen and orange on the other. Aligned with the fit labels
 * ("Fit fort" >= 78, "Fit partiel" >= 45, "Fit faible" below).
 */
export type ScoreTone = "success" | "warning" | "destructive";

export const SCORE_THRESHOLDS = { strong: 78, partial: 45 } as const;

export function scoreTone(score: number): ScoreTone {
  if (score >= SCORE_THRESHOLDS.strong) return "success";
  if (score >= SCORE_THRESHOLDS.partial) return "warning";
  return "destructive";
}

export const SCORE_TONE_BG: Record<ScoreTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

import { useParams, Link, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { useRun } from "@/hooks/use-tailor";
import { Card, CardContent, type CardProps } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, badgeVariants, type BadgeProps } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Mascot } from "@/components/brand/mascot";
import { cn } from "@/lib/utils";
import { SCORE_THRESHOLDS, scoreTone, type ScoreTone } from "@/lib/score";
import {
  ArrowLeft, Copy, Check, AlertCircle, CheckCircle, AlertTriangle,
  Lightbulb, Hash, ChevronDown, ChevronUp,
  Globe, ShieldCheck, Zap, RefreshCw, Pencil, X,
  WandSparkles, Library, BookOpen, ExternalLink, Plus, Sparkles, FileDown,
  Send, Calendar
} from "lucide-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

function decodeUtf8FromLatin1(text: string): string {
  try {
    const bytes = Uint8Array.from(text, char => char.charCodeAt(0) & 0xff);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return text;
  }
}

function repairMojibake(text: string): string {
  let repaired = String(text ?? "");

  for (let i = 0; i < 2; i += 1) {
    if (!/[\u00C3\u00C2\u00E2]/.test(repaired)) break;
    const decoded = decodeUtf8FromLatin1(repaired);
    if (!decoded || decoded === repaired) break;
    repaired = decoded;
  }

  return repaired
    .replace(/\u00a0/g, " ")
    .replace(/\u00c2/g, "")
    .replace(/\r/g, "");
}

// ── Score tones (DS rule: >= 70 success, >= 45 warning, else destructive) ──



/** Inverted scale for risk metrics (lower is better). */
function riskTone(risk: number): ScoreTone {
  if (risk <= 35) return "success";
  if (risk < 60) return "warning";
  return "destructive";
}

const TONE_TEXT: Record<ScoreTone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

const TONE_BG: Record<ScoreTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

const TONE_STROKE: Record<ScoreTone, string> = {
  success: "stroke-success",
  warning: "stroke-warning",
  destructive: "stroke-destructive",
};

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

// ── Shared primitives ──

const RING_SIZES = {
  lg: { px: 68, stroke: 6, box: "size-[68px]", text: "text-base" },
  md: { px: 56, stroke: 5, box: "size-14", text: "text-sm" },
} as const;

/** Single score ring used by the header and the diagnosis card. */
function ScoreRing({ value, size = "lg", valueTestId }: { value: number; size?: keyof typeof RING_SIZES; valueTestId?: string }) {
  const { px, stroke, box, text } = RING_SIZES[size];
  const radius = (px - stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, value)) / 100);

  return (
    <div className={cn("relative shrink-0", box)}>
      <svg width={px} height={px} className="block -rotate-90" aria-hidden="true">
        <circle cx={px / 2} cy={px / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-secondary" />
        <circle
          cx={px / 2} cy={px / 2} r={radius}
          fill="none" strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn(TONE_STROKE[scoreTone(value)], "transition-[stroke-dashoffset] duration-700 ease-out")}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={cn("font-extrabold tabular-nums text-foreground", text)} data-testid={valueTestId}>{value}%</span>
      </div>
    </div>
  );
}

/** Thin horizontal score bar (track = secondary, fill = tone). Width is the only inline style allowed. */
function ScoreBar({ value, tone, className }: { value: number; tone: ScoreTone; className?: string }) {
  return (
    <div className={cn("h-1.5 flex-1 overflow-hidden rounded-full bg-secondary", className)}>
      <div className={cn("h-full rounded-full transition-all duration-700", TONE_BG[tone])} style={{ width: `${value}%` }} />
    </div>
  );
}

/** Label + bar + value (+ optional hint) used in score breakdowns. */
function MetricBar({ label, value, tone, hint }: { label: string; value: number; tone: ScoreTone; hint?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-2xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <ScoreBar value={value} tone={tone} />
        <span className="text-2xs font-bold tabular-nums text-muted-foreground">{value}%</span>
      </div>
      {hint && <p className="text-2xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Right-column card: 12px radius, light border, no shadow (consistent across the aside). */
function AsideCard({ className, ...props }: CardProps) {
  return <Card variant="document" className={cn("shadow-none", className)} {...props} />;
}

/** Small uppercase label used inside the aside cards. */
const MICRO_LABEL = "text-2xs font-semibold uppercase tracking-wider text-muted-foreground";
/** Section label inside the CV document (CV généré / Super CV / Annonce). */
const DOC_EYEBROW = "whitespace-nowrap text-eyebrow-sm font-extrabold uppercase text-muted-foreground";
/** "+N" / "voir plus" chips. */
const CHIP_BUTTON = "h-6 min-h-0 rounded-full px-2 text-2xs";

function DocSectionHeading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <h2 className={DOC_EYEBROW}>{children}</h2>
      <div className="h-px flex-1 bg-border/70" />
    </div>
  );
}

// ── Keyword highlighter ──

function highlightKeywords(text: string, keywords: string[]): React.ReactNode {
  if (!keywords.length) return text;
  const sorted = [...keywords].sort((a, b) => b.length - a.length);
  const escaped = sorted.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  if (parts.length <= 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1
      ? <mark key={i} className="rounded-xs bg-warning-soft px-0.5 font-semibold not-italic text-warning-strong">{part}</mark>
      : part
  );
}

// ── Formatted CV document renderer ──

const IS_FORMATION = /^(EDUCATION|FORMATION|FORMATION PROFESSIONNELLE)\s*$/i;
const IS_LANGUES   = /^(LANGUAGES?|LANGUES?)\s*$/i;

const CV_BODY = "text-sm leading-[21px]";

function renderCVLine(line: string, i: number, keywords: string[], isFirstContent: { val: boolean }, compact = false): JSX.Element | null {
  if (line.startsWith("### ")) {
    const content = line.replace(/^###\s*/, "").replace(/\*\*/g, "");
    const parts = content.split("|").map(p => p.trim());
    const [roleRaw, company] = parts.length > 1 ? [parts[0], parts[1]] : [content, ""];
    return (
      <div key={i} className="mt-3.5 first:mt-0">
        <p className={cn(CV_BODY, "font-medium text-foreground/85")}>
          {roleRaw}
          {company && <> | {company}</>}
        </p>
      </div>
    );
  }

  if (line.startsWith("## ")) {
    const heading = line.replace(/^##\s*/, "").replace(/\*\*/g, "").toUpperCase();
    return <DocSectionHeading key={i} className="mt-4 first:mt-0">{heading}</DocSectionHeading>;
  }

  if (/^(skills?|competences?)[:\s]*/i.test(line) && !/^(?:[-*•])\s+/.test(line)) {
    const rest = line.replace(/^(skills?|competences?)[:\s]*/i, "").trim();
    const sectionLabel = /^competences?/i.test(line) ? "Compétences" : "Skills";
    return (
      <div key={i} className="mt-4">
        <DocSectionHeading className="mb-3">{sectionLabel}</DocSectionHeading>
        {rest && (
          <div className="flex flex-wrap gap-2">
            {rest.split(/[•,|]/).map(s => s.trim()).filter(Boolean).map((skill, j) => (
              <Badge key={j} variant="tag">{repairMojibake(skill)}</Badge>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (/^(PROFESSIONAL SUMMARY|RESUME PROFESSIONNEL|EXPERIENCE PROFESSIONNELLE?|EXPERIENCE|EDUCATION|FORMATION|LANGUAGES?|LANGUES?)\s*$/i.test(line)) {
    return <DocSectionHeading key={i} className="mt-4 first:mt-0">{line}</DocSectionHeading>;
  }

  if (/^(?:[-*•])\s+/.test(line)) {
    const bulletText = line.replace(/^(?:[-*•])\s+/, "").replace(/\*\*/g, "");
    if (compact) {
      return (
        <p key={i} className={cn(CV_BODY, "text-foreground/85")}>
          <span className="text-foreground/40">• </span>{highlightKeywords(bulletText, keywords)}
        </p>
      );
    }
    return (
      <div key={i} className="flex items-start gap-2.5 pl-0.5">
        <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
        <p className={cn(CV_BODY, "text-foreground/90")}>{highlightKeywords(bulletText, keywords)}</p>
      </div>
    );
  }

  if (/^\d{4}/.test(line) && (line.includes("-") || /present/i.test(line))) {
    return <p key={i} className={cn(CV_BODY, "text-muted-foreground")}>{line}</p>;
  }

  const content = line.replace(/\*\*/g, "").replace(/^#+\s*/, "");
  if (isFirstContent.val && i <= 3) {
    if (i === 0) {
      isFirstContent.val = false;
      return <h1 key={i} className="text-xl font-bold leading-7 tracking-tight text-foreground">{content}</h1>;
    }
    return <p key={i} className={cn(CV_BODY, "text-foreground/85")}>{highlightKeywords(content, keywords)}</p>;
  }

  return <p key={i} className={cn(CV_BODY, "text-foreground/85")}>{highlightKeywords(content, keywords)}</p>;
}

function FormattedCV({ text, keywords = [] }: { text: string; keywords?: string[] }) {
  const lines = repairMojibake(text).split("\n");
  const isFirstContent = { val: true };

  // Locate FORMATION and LANGUES section start indices
  let formationStart = -1;
  let languesStart   = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = repairMojibake(lines[i]).trim();
    if (IS_FORMATION.test(l) && formationStart === -1) formationStart = i;
    if (IS_LANGUES.test(l)   && languesStart   === -1) languesStart   = i;
  }

  // Find where each section ends (next ## heading or EOF)
  const nextSectionAfter = (start: number) => {
    for (let i = start + 1; i < lines.length; i++) {
      const l = repairMojibake(lines[i]).trim();
      if (l.startsWith("## ") || IS_FORMATION.test(l) || IS_LANGUES.test(l) ||
          /^(PROFESSIONAL SUMMARY|RESUME PROFESSIONNEL|EXPERIENCE PROFESSIONNELLE?|EXPERIENCE|EDUCATION|FORMATION|LANGUAGES?|LANGUES?)\s*$/i.test(l)) {
        return i;
      }
    }
    return lines.length;
  };

  const formationEnd = formationStart >= 0 ? nextSectionAfter(formationStart) : -1;
  const languesEnd   = languesStart   >= 0 ? nextSectionAfter(languesStart)   : -1;

  const bothExist = formationStart >= 0 && languesStart >= 0;

  // Indices to skip when rendering main pass (handled in grid block)
  const skipStart = bothExist ? Math.min(formationStart, languesStart) : -1;
  const skipEnd   = bothExist ? Math.max(formationEnd,   languesEnd)   : -1;

  const elements: JSX.Element[] = [];

  for (let i = 0; i < lines.length; i++) {
    // Skip lines that will be rendered in the 2-col grid
    if (bothExist && i >= skipStart && i < skipEnd) {
      if (i === skipStart) {
        // Build formation col
        const fLines = lines.slice(formationStart, formationEnd);
        const lLines = lines.slice(languesStart,   languesEnd);

        const fElems = fLines.map((l, j) => {
          const t = repairMojibake(l).trim();
          if (!t) return null;
          return renderCVLine(t, formationStart + j + 10000, keywords, isFirstContent, true);
        }).filter(Boolean) as JSX.Element[];

        const lElems = lLines.map((l, j) => {
          const t = repairMojibake(l).trim();
          if (!t) return null;
          return renderCVLine(t, languesStart + j + 20000, keywords, isFirstContent, true);
        }).filter(Boolean) as JSX.Element[];

        elements.push(
          <div key="formation-langues-grid" className="mt-4 grid grid-cols-1 items-start gap-x-8 gap-y-4 sm:grid-cols-2">
            <div className="space-y-2">{fElems}</div>
            <div className="space-y-2">{lElems}</div>
          </div>
        );
      }
      continue;
    }

    const line = repairMojibake(lines[i]).trim();
    if (!line) {
      if (elements.length > 0) elements.push(<div key={`gap-${i}`} className="h-2" />);
      continue;
    }
    const el = renderCVLine(line, i, keywords, isFirstContent);
    if (el) elements.push(el);
  }

  return <div className="space-y-1.5 font-sans">{elements}</div>;
}

// ── Report Sections ──

const MODE_META: Record<string, { label: string; icon: React.ReactNode; variant: BadgeVariant }> = {
  original: { label: "Fidèle", icon: <ShieldCheck />, variant: "primary" },
  polished: { label: "Optimisé", icon: <Zap />, variant: "info" },
  adaptive: { label: "Adaptatif", icon: <RefreshCw />, variant: "success" },
};

type BadgeLevel = "probant" | "a_renforcer" | "fragile";
type GeneratedCvFitNiveau = "coherent" | "trop_junior" | "trop_senior" | "uncertain";
type HardWarningCode =
  | "junior_scope_mismatch"
  | "lead_scope_underproven"
  | "pm_scope_underproven"
  | "niche_domain_underproven"
  | "text_integrity_issue";

type ReportScoreBreakdown = {
  fitOffer?: number;
  ats: number;
  atsOptimized?: number;
  atsBoost?: number;
  contextSupport?: number;
  semantic: number;
  recruiterCredibility?: "forte" | "correcte" | "fragile" | "faible";
  domainMismatch?: string;
  cappedByKeywords?: boolean;
  cappedByEvidence?: boolean;
  pertinence?: number;
  fitMetier?: number;
  fitNiveauFactor?: number;
  fitNiveau?: GeneratedCvFitNiveau;
  forcePreuve?: number;
  credibiliteCv?: number;
  evidenceGrounding?: number;
  recruiterCredibilityScore?: number;
  atsReadiness?: number;
  overstatementRisk?: number;
  badge?: BadgeLevel;
  distanceDomain?: "same" | "adjacent" | "different";
  hardWarnings?: HardWarningCode[];
  textIntegrityScore?: number;
  optimizationDecision?: "faithful_only" | "optimized_selected" | "optimized_rejected";
  optimizationNotes?: string[];
  variantStrategy?: "faithful" | "optimized_humain";
  scoreModel?: "generated_cv_v1" | "legacy_fallback" | "profile_frame_v3";
  debugOverlaps?: { workObjects: number; deliverables: number; decisions: number };
};

type DiagnosisCause =
  | "job_parsing_issue"
  | "library_too_thin"
  | "bullets_too_generic"
  | "mission_context_too_weak"
  | "evidence_vs_ats_gap"
  | "scoring_calibration_gap"
  | "proof_gap"
  | "cv_not_credible"
  | "adjacent_role"
  | "level_mismatch"
  | "strong_fit";

function getFitLabel(score: number) {
  const tone = scoreTone(score);
  const label = score >= SCORE_THRESHOLDS.strong ? "Fit fort" : score >= SCORE_THRESHOLDS.partial ? "Fit partiel" : "Fit faible";
  return { label, tone, textColor: TONE_TEXT[tone] };
}

function getBadgeMeta(badge?: BadgeLevel): { label: string; variant: BadgeVariant } {
  switch (badge) {
    case "probant":
      return { label: "Probant", variant: "success" };
    case "a_renforcer":
      return { label: "À renforcer", variant: "warning" };
    case "fragile":
      return { label: "Fragile", variant: "destructive" };
    default:
      return { label: "n/a", variant: "secondary" };
  }
}

function getCredibilityMeta(credibility?: ReportScoreBreakdown["recruiterCredibility"]): { label: string; variant: BadgeVariant } {
  switch (credibility) {
    case "forte":
      return { label: "Crédibilité forte", variant: "success" };
    case "correcte":
      return { label: "Crédibilité correcte", variant: "primary" };
    case "fragile":
      return { label: "Crédibilité fragile", variant: "warning" };
    case "faible":
      return { label: "Crédibilité faible", variant: "destructive" };
    default:
      return { label: "Crédibilité n/a", variant: "secondary" };
  }
}

function getCauseLabel(cause?: DiagnosisCause) {
  switch (cause) {
    case "job_parsing_issue":
      return "Annonce mal interpretee";
    case "library_too_thin":
      return "Bibliotheque trop fine";
    case "bullets_too_generic":
      return "Bullets trop generiques";
    case "mission_context_too_weak":
      return "Contexte mission trop faible";
    case "evidence_vs_ats_gap":
      return "ATS superieur aux preuves";
    case "scoring_calibration_gap":
      return "Calibrage moteur a surveiller";
    case "proof_gap":
      return "Preuves trop faibles";
    case "cv_not_credible":
      return "CV pas encore credible";
    case "adjacent_role":
      return "Role adjacent";
    case "level_mismatch":
      return "Niveau incoherent";
    case "strong_fit":
      return "Bon alignement";
    default:
      return "Cause non determinee";
  }
}

function getDistanceDomainLabel(distance?: ReportScoreBreakdown["distanceDomain"]) {
  switch (distance) {
    case "same":
      return "Metier proche";
    case "adjacent":
      return "Metier adjacent";
    case "different":
      return "Metier different";
    default:
      return null;
  }
}

function getFitNiveauLabel(level?: GeneratedCvFitNiveau) {
  switch (level) {
    case "coherent":
      return "Niveau coherent";
    case "trop_junior":
      return "Poste trop junior";
    case "trop_senior":
      return "Poste plus senior";
    case "uncertain":
      return "Niveau a confirmer";
    default:
      return null;
  }
}

function getHardWarningMeta(code: HardWarningCode) {
  switch (code) {
    case "junior_scope_mismatch":
      return {
        label: "Poste junior ou stage",
        description: "Ton profil parait plus senior que le scope reel de l'offre.",
        variant: "destructive" as BadgeVariant,
      };
    case "lead_scope_underproven":
      return {
        label: "Scope lead peu prouve",
        description: "Le metier est proche, mais le leadership reel reste encore peu ancre dans tes preuves.",
        variant: "warning" as BadgeVariant,
      };
    case "pm_scope_underproven":
      return {
        label: "Scope PM / CRM peu prouve",
        description: "Le poste attend un vrai scope product management que le profil ne prouve pas assez.",
        variant: "destructive" as BadgeVariant,
      };
    case "niche_domain_underproven":
      return {
        label: "Domaine niche partiellement prouve",
        description: "Le role reste plausible, mais les preuves tres specifiques du domaine sont encore limites.",
        variant: "warning" as BadgeVariant,
      };
    case "text_integrity_issue":
      return {
        label: "Texte corrompu",
        description: "Des artefacts d'encodage reduisent fortement la credibilite du document.",
        variant: "destructive" as BadgeVariant,
      };
    default:
      return {
        label: code,
        description: "",
        variant: "secondary" as BadgeVariant,
      };
  }
}

function getOptimizationDecisionMeta(decision?: ReportScoreBreakdown["optimizationDecision"]) {
  switch (decision) {
    case "faithful_only":
      return {
        label: "Version fidele servie",
        variant: "secondary" as BadgeVariant,
      };
    case "optimized_selected":
      return {
        label: "Optimise humain retenu",
        variant: "success" as BadgeVariant,
      };
    case "optimized_rejected":
      return {
        label: "CV fidele (optimisation rejetee)",
        variant: "warning" as BadgeVariant,
      };
    default:
      return null;
  }
}

function computeLetterGrade(scoreBreakdown?: ReportScoreBreakdown, confidence?: number): { grade: string; label: string; variant: BadgeVariant } | null {
  const score = scoreBreakdown?.pertinence ?? scoreBreakdown?.fitOffer ?? confidence;
  if (score == null) return null;
  const hasHardWarnings = (scoreBreakdown?.hardWarnings?.length ?? 0) > 0;
  const overstatement = scoreBreakdown?.overstatementRisk ?? 0;
  const fitNiveau = scoreBreakdown?.fitNiveau;
  const domain = scoreBreakdown?.distanceDomain;
  const levelMismatch = fitNiveau === "trop_junior" || fitNiveau === "trop_senior";

  if (hasHardWarnings || overstatement > 80) {
    return { grade: "F", label: "Hors zone", variant: "destructive" as BadgeVariant };
  }
  if (score >= 80 && !levelMismatch && domain !== "different") {
    return { grade: "A", label: "Excellent", variant: "success" as BadgeVariant };
  }
  if (score >= 60 && !levelMismatch) {
    return { grade: "B", label: "Bon fit", variant: "success" as BadgeVariant };
  }
  if (score >= 40 || domain === "adjacent") {
    return { grade: "C", label: "Partiel", variant: "warning" as BadgeVariant };
  }
  if (score >= 20) {
    return { grade: "D", label: "Faible", variant: "warning" as BadgeVariant };
  }
  return { grade: "F", label: "Hors zone", variant: "destructive" as BadgeVariant };
}

function computeWarningBanner(scoreBreakdown?: ReportScoreBreakdown, fallbackUsed?: boolean): { severity: "error" | "warn" | "info"; message: string } | null {
  const hardWarnings = scoreBreakdown?.hardWarnings || [];
  if (hardWarnings.length > 0) {
    const meta = getHardWarningMeta(hardWarnings[0]);
    return { severity: "error", message: meta.label + (hardWarnings.length > 1 ? ` (+${hardWarnings.length - 1} autre${hardWarnings.length > 2 ? "s" : ""})` : "") };
  }
  if (scoreBreakdown?.domainMismatch || scoreBreakdown?.distanceDomain === "different") {
    return { severity: "warn", message: `Domaine different (${scoreBreakdown?.domainMismatch || "distance metier"}) — les competences se croisent mais le coeur du role differe.` };
  }
  if (fallbackUsed) {
    return { severity: "info", message: "Peu de bullets forts trouves pour cette annonce — selection de secours appliquee." };
  }
  return null;
}

function MatchScore({ confidence, reasoning, fallbackUsed, scoreBreakdown }: { confidence: number; reasoning?: string; fallbackUsed?: boolean; scoreBreakdown?: ReportScoreBreakdown }) {
  const displayScore = scoreBreakdown?.pertinence ?? scoreBreakdown?.fitOffer ?? confidence;
  const fitMeta = getFitLabel(displayScore);

  const insightSentence = reasoning || null;
  const optimizedAts = scoreBreakdown?.atsOptimized;
  const atsBoost = scoreBreakdown?.atsBoost || 0;
  const badgeMeta = getBadgeMeta(scoreBreakdown?.badge);
  const distanceLabel = getDistanceDomainLabel(scoreBreakdown?.distanceDomain);
  const fitNiveauLabel = getFitNiveauLabel(scoreBreakdown?.fitNiveau);
  const evidenceGrounding = scoreBreakdown?.evidenceGrounding ?? scoreBreakdown?.forcePreuve;
  const recruiterCredibilityScore = scoreBreakdown?.recruiterCredibilityScore ?? scoreBreakdown?.credibiliteCv;
  const overstatementRisk = scoreBreakdown?.overstatementRisk;
  const letterGrade = computeLetterGrade(scoreBreakdown, confidence);

  return (
    <AsideCard data-testid="section-match-score">
      <CardContent className="p-4">
        {/* Domain mismatch warning — prominent, above the ring */}
        {(scoreBreakdown?.domainMismatch || scoreBreakdown?.distanceDomain === "different") && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft p-2.5">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <p className="text-2xs font-medium leading-snug text-warning-strong">
              Mismatch détecté ({scoreBreakdown.domainMismatch || "distance metier"}) : les compétences se croisent partiellement mais le coeur du rôle diffère.
            </p>
          </div>
        )}

        <div className="flex items-center gap-4">
          <ScoreRing value={displayScore} size="md" valueTestId="text-match-score-value" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn("text-sm font-bold", fitMeta.textColor)} data-testid="text-match-score-label">{fitMeta.label}</p>
              {letterGrade && (
                <Badge variant={letterGrade.variant} className="font-bold" title={letterGrade.label}>
                  {letterGrade.grade}
                </Badge>
              )}
              {scoreBreakdown?.badge && (
                <Badge variant={badgeMeta.variant} className="font-semibold">{badgeMeta.label}</Badge>
              )}
            </div>
            {fallbackUsed && (
              <p className="mt-0.5 text-2xs font-medium text-warning">Match faible : bullets de substitution utilisés</p>
            )}
            {(distanceLabel || fitNiveauLabel) && (
              <p className="mt-1 text-2xs text-muted-foreground">
                {[distanceLabel, fitNiveauLabel].filter(Boolean).join(" • ")}
              </p>
            )}
          </div>
        </div>

        {/* V3 breakdown: Fit metier + ancrage preuves + credibilite + risque */}
        {scoreBreakdown?.fitMetier != null && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/50 pt-3 sm:grid-cols-4">
            <MetricBar label="Fit métier" value={scoreBreakdown!.fitMetier!} tone={scoreTone(scoreBreakdown!.fitMetier!)} />
            <MetricBar label="Ancrage preuves" value={evidenceGrounding!} tone={scoreTone(evidenceGrounding!)} />
            <MetricBar label="Crédibilité" value={recruiterCredibilityScore!} tone={scoreTone(recruiterCredibilityScore!)} />
            <MetricBar label="Risque survente" value={overstatementRisk!} tone={riskTone(overstatementRisk!)} />
          </div>
        )}
        {/* Legacy breakdown: ATS + semantic (when v3 not available) */}
        {scoreBreakdown && scoreBreakdown.fitMetier == null && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/50 pt-3">
            <MetricBar label="Keywords prouvés" value={scoreBreakdown.ats} tone={scoreTone(scoreBreakdown.ats)} />
            <MetricBar label="Bullets sémantiques" value={scoreBreakdown.semantic} tone={scoreTone(scoreBreakdown.semantic)} />
          </div>
        )}
        {scoreBreakdown && optimizedAts !== undefined && optimizedAts > scoreBreakdown.ats && (
          <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">
            ATS final du CV : <span className="font-semibold text-foreground">{optimizedAts}%</span>
            {atsBoost ? ` (+${atsBoost}% via optimisation)` : ""}
            {overstatementRisk != null ? ", a lire apres la credibilite et l'ancrage preuves." : ""}
          </p>
        )}

        {insightSentence && !scoreBreakdown && (
          <p className="mt-3 border-t border-border/50 pt-3 text-2xs italic leading-relaxed text-muted-foreground" data-testid="text-match-score-insight">
            {insightSentence}.
          </p>
        )}
      </CardContent>
    </AsideCard>
  );
}

function SkillsCoverage({ matched, missing }: { matched: string[]; missing: string[] }) {
  const total = matched.length + missing.length;
  const pct = total === 0 ? 0 : Math.round((matched.length / total) * 100);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [showAllMatched, setShowAllMatched] = useState(false);
  const [showAllMissing, setShowAllMissing] = useState(false);
  const MATCHED_CAP = 8;
  const MISSING_CAP = 8;

  const mutation = useMutation({
    mutationFn: (skill: string) =>
      apiRequest("POST", "/api/skills", { name: skill, level: null, priority: 0 }),
    onSuccess: (_: unknown, skill: string) => {
      setAdded(prev => new Set([...prev, skill]));
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
    },
  });

  const handleAdd = (skill: string) => {
    if (!added.has(skill) && !mutation.isPending) mutation.mutate(skill);
  };

  const visibleMatched = showAllMatched ? matched : matched.slice(0, MATCHED_CAP);
  const visibleMissing = showAllMissing ? missing : missing.slice(0, MISSING_CAP);

  return (
    <div className="space-y-3" data-testid="section-skills-coverage">
      <div className="flex items-center justify-between">
        <h4 className={cn(MICRO_LABEL, "text-foreground")}>Skills de l'offre</h4>
        <span className="text-xs font-bold tabular-nums text-primary">{matched.length}/{total}</span>
      </div>
      <ScoreBar value={pct} tone={scoreTone(pct)} className="flex-none" />
      {matched.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {visibleMatched.map((s, i) => (
            <Badge key={i} variant="success" data-testid={`badge-matched-${i}`}>
              <CheckCircle /> {repairMojibake(s)}
            </Badge>
          ))}
          {!showAllMatched && matched.length > MATCHED_CAP && (
            <Button variant="secondary" size="sm" onClick={() => setShowAllMatched(true)} className={CHIP_BUTTON}>
              +{matched.length - MATCHED_CAP}
            </Button>
          )}
        </div>
      )}
      {missing.length > 0 && (
        <div>
          <p className={cn(MICRO_LABEL, "mb-1.5")}>
            {matched.length === 0 ? "Absentes — cliquer pour ajouter" : "Manquantes — cliquer pour ajouter"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {visibleMissing.map((s, i) => {
              const isAdded = added.has(s);
              return (
                <Button
                  key={i}
                  variant="secondary"
                  size="sm"
                  data-testid={`badge-missing-${i}`}
                  onClick={() => handleAdd(s)}
                  disabled={isAdded || mutation.isPending}
                  title={isAdded ? "Ajouté à la bibliothèque" : "Ajouter à la bibliothèque"}
                  className={cn(
                    CHIP_BUTTON,
                    "gap-1 [&_svg]:size-3",
                    isAdded
                      ? "bg-success-soft text-success-strong disabled:opacity-100"
                      : "bg-warning-soft text-warning-strong hover:bg-warning-soft/70",
                  )}
                >
                  {isAdded ? <Check /> : <Plus />}
                  {repairMojibake(s)}
                </Button>
              );
            })}
            {!showAllMissing && missing.length > MISSING_CAP && (
              <Button variant="secondary" size="sm" onClick={() => setShowAllMissing(true)} className={CHIP_BUTTON}>
                +{missing.length - MISSING_CAP}
              </Button>
            )}
          </div>
        </div>
      )}
      {total === 0 && <p className="text-xs italic text-muted-foreground">Aucune donnée de compétence disponible.</p>}
    </div>
  );
}

function KeyTips({ tips, insight }: { tips: string[]; insight?: string }) {
  const [showAll, setShowAll] = useState(false);
  const hasContent = (tips && tips.length > 0) || insight;
  if (!hasContent) return null;
  const TIPS_CAP = 3;
  const visibleTips = showAll ? tips : tips.slice(0, TIPS_CAP);

  return (
    <div className="space-y-2" data-testid="section-tips">
      {insight && (
        <p className="border-l-2 border-warning/50 pl-2 text-xs italic leading-relaxed text-foreground/70" data-testid="text-insight">
          {repairMojibake(insight)}
        </p>
      )}
      {tips && tips.length > 0 && (
        <>
          <ul className="space-y-1.5">
            {visibleTips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-foreground/80" data-testid={`text-tip-${i}`}>
                <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-warning" />
                {repairMojibake(tip)}
              </li>
            ))}
          </ul>
          {tips.length > TIPS_CAP && (
            <Button variant="link" onClick={() => setShowAll(v => !v)} className="text-2xs text-muted-foreground hover:text-foreground">
              {showAll ? "Réduire" : `Voir les ${tips.length - TIPS_CAP} autres conseils`}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/** Sub-scores are for engine debugging, not for the user (see CLAUDE.md "Surface produit"). */
const SHOW_DEBUG = (() => {
  if (import.meta.env.DEV) return true;
  try {
    return window.localStorage.getItem("dispatch:debug") === "1";
  } catch {
    return false;
  }
})();

/** Collapsible row at the bottom of the aside (Bibliothèque / Debug). */
function AsideDisclosure({
  icon, label, open, onToggle, children, testId, toggleTestId,
}: {
  icon: React.ReactNode; label: React.ReactNode; open: boolean; onToggle: () => void;
  children: React.ReactNode; testId?: string; toggleTestId?: string;
}) {
  return (
    <AsideCard data-testid={testId}>
      <Button
        variant="ghost"
        onClick={onToggle}
        className="h-auto w-full justify-between px-4 py-3 text-xs font-semibold [&_svg]:size-3.5"
        data-testid={toggleTestId}
      >
        <span className="flex items-center gap-2">{icon} {label}</span>
        {open ? <ChevronUp /> : <ChevronDown />}
      </Button>
      {open && (
        <div className="rounded-b-md border-t border-border/60 bg-secondary/25 px-4 py-3">
          {children}
        </div>
      )}
    </AsideCard>
  );
}

function LibraryHealthAccordion({ selectedBullets, selectedExperiences, totalBullets, bulletsWithNumbers }: {
  selectedBullets: any[]; selectedExperiences: any[]; totalBullets: number; bulletsWithNumbers: number;
}) {
  const [open, setOpen] = useState(false);
  const pctWithNumbers = Math.round(bulletsWithNumbers / Math.max(1, totalBullets) * 100);
  const pctWithTags = Math.round(
    selectedBullets.filter(b => b.matchedKeywords?.length > 0).length / Math.max(1, selectedBullets.length) * 100
  );
  const expWithDescription = selectedExperiences.filter(e => e.reason && e.reason !== "Timeline continuity").length;
  const score = Math.round(
    (pctWithNumbers + pctWithTags + (expWithDescription / Math.max(1, selectedExperiences.length) * 100)) / 3
  );

  return (
    <AsideDisclosure
      icon={<Library />}
      label={<>Bibliothèque — {score}%</>}
      open={open}
      onToggle={() => setOpen(v => !v)}
      testId="section-library-health"
    >
      <div className="space-y-3">
        <ScoreBar value={score} tone={scoreTone(score)} className="flex-none" />
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="text-2xs text-muted-foreground">Bullets chiffrées : <span className="font-medium text-foreground">{pctWithNumbers}%</span></span>
          <span className="text-2xs text-muted-foreground">Keywords matchés : <span className="font-medium text-foreground">{pctWithTags}%</span></span>
          <span className="text-2xs text-muted-foreground">Expériences avec contexte : <span className="font-medium text-foreground">{expWithDescription}/{selectedExperiences.length}</span></span>
        </div>
      </div>
    </AsideDisclosure>
  );
}

function DetailsDisclosure({ report, scoreBreakdown }: { report: any; scoreBreakdown?: ReportScoreBreakdown }) {
  const [open, setOpen] = useState(false);
  const [showKeywords, setShowKeywords] = useState(false);
  const displayScore = scoreBreakdown?.pertinence ?? scoreBreakdown?.fitOffer ?? report?.confidence ?? 0;
  const credibilityMeta = getCredibilityMeta(scoreBreakdown?.recruiterCredibility);
  const badgeMeta = getBadgeMeta(scoreBreakdown?.badge);
  const distanceLabel = getDistanceDomainLabel(scoreBreakdown?.distanceDomain);
  const fitNiveauLabel = getFitNiveauLabel(scoreBreakdown?.fitNiveau);
  const evidenceGrounding = scoreBreakdown?.evidenceGrounding ?? scoreBreakdown?.forcePreuve;
  const recruiterCredibilityScore = scoreBreakdown?.recruiterCredibilityScore ?? scoreBreakdown?.credibiliteCv;
  const overstatementRisk = scoreBreakdown?.overstatementRisk;
  const letterGrade = computeLetterGrade(scoreBreakdown, report?.confidence);

  return (
    <AsideDisclosure
      icon={<BookOpen />}
      label={<>Debug &amp; métriques</>}
      open={open}
      onToggle={() => setOpen(v => !v)}
      testId="section-details"
      toggleTestId="button-toggle-details"
    >
      <div className="space-y-4 py-1">
        {scoreBreakdown && (
          <div>
            <p className={cn(MICRO_LABEL, "mb-2")}>Détail du score</p>
            {scoreBreakdown?.fitMetier != null ? (
              <div className="grid grid-cols-2 gap-3">
                <MetricBar
                  label="Pertinence" value={displayScore} tone={scoreTone(displayScore)}
                  hint="Repere de triage base sur le document genere, le bon metier, la preuve source et la credibilite du CV."
                />
                <MetricBar
                  label="Fit métier" value={scoreBreakdown!.fitMetier!} tone={scoreTone(scoreBreakdown!.fitMetier!)}
                  hint="Juge la proximite du metier a partir du CV genere et des bullets sources retenus, pas du titre seul."
                />
                <MetricBar
                  label="Ancrage preuves" value={evidenceGrounding!} tone={scoreTone(evidenceGrounding!)}
                  hint="Mesure a quel point le document final reste bien ancre dans les preuves concretes de ton parcours."
                />
                <MetricBar
                  label="Crédibilité recruteur" value={recruiterCredibilityScore!} tone={scoreTone(recruiterCredibilityScore!)}
                  hint="Estime si un recruteur humain croira le document final, au-dela de l'ATS et du vernis lexical."
                />
                <MetricBar
                  label="Risque de survente" value={overstatementRisk!} tone={riskTone(overstatementRisk!)}
                  hint="Frein de securite si la reformulation ou l'ATS poussent le document au-dela de ce que le profil prouve vraiment."
                />
                <div className="space-y-1">
                  <p className="text-2xs font-medium text-muted-foreground">Badge document</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {letterGrade && (
                      <Badge variant={letterGrade.variant} className="font-bold" title={letterGrade.label}>
                        {letterGrade.grade} — {letterGrade.label}
                      </Badge>
                    )}
                    <Badge variant={badgeMeta.variant} className="font-semibold">{badgeMeta.label}</Badge>
                  </div>
                  <p className="text-2xs leading-relaxed text-muted-foreground">Resume si le CV genere parait probant, a renforcer ou fragile.</p>
                </div>
                {(distanceLabel || fitNiveauLabel) && (
                  <div className="space-y-1">
                    <p className="text-2xs font-medium text-muted-foreground">Lecture rapide</p>
                    <div className="flex flex-wrap gap-1.5">
                      {distanceLabel && <Badge variant="outline" className="font-semibold text-foreground">{distanceLabel}</Badge>}
                      {fitNiveauLabel && <Badge variant="outline" className="font-semibold text-foreground">{fitNiveauLabel}</Badge>}
                    </div>
                    <p className="text-2xs leading-relaxed text-muted-foreground">Ces libelles resument la distance metier et la coherence de niveau du document final.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <MetricBar
                  label="Fit offre" value={displayScore} tone={scoreTone(displayScore)}
                  hint="Mesure ce que ta bibliotheque prouve vraiment pour cette offre, avant le vernis ATS."
                />
                <MetricBar label="ATS prouvé" value={scoreBreakdown.ats} tone={scoreTone(scoreBreakdown.ats)} />
                <MetricBar
                  label="Bullets sémantiques" value={scoreBreakdown.semantic} tone={scoreTone(scoreBreakdown.semantic)}
                  hint="Mesure a quel point les bullets retenus racontent quelque chose de proche du role, meme sans reprendre mot pour mot l'annonce."
                />
                <div className="space-y-1">
                  <p className="text-2xs font-medium text-muted-foreground">Crédibilité recruteur</p>
                  <div>
                    <Badge variant={credibilityMeta.variant} className="font-semibold">{credibilityMeta.label}</Badge>
                  </div>
                  <p className="text-2xs leading-relaxed text-muted-foreground">Estime si un humain croirait a la promesse du CV final, au-dela des seuls mots-cles.</p>
                </div>
              </div>
            )}
            {scoreBreakdown.atsOptimized !== undefined && (
              <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">
                ATS final du document : <span className="font-semibold text-foreground">{scoreBreakdown.atsOptimized}%</span>
                {scoreBreakdown.atsBoost ? `, dont ${scoreBreakdown.atsBoost}% vient d'optimisations de texte.` : "."}
                {" "}Cet axe reste secondaire face a la credibilite et a l'ancrage preuves.
              </p>
            )}
            {scoreBreakdown.contextSupport !== undefined && scoreBreakdown.contextSupport > 0 && (
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                Contexte mission : <span className="font-semibold text-foreground">{scoreBreakdown.contextSupport}%</span> de support secondaire detecte.
              </p>
            )}
          </div>
        )}

        {/* Detected Keywords */}
        {report.detectedKeywords && (
          <div>
            <Button
              variant="link"
              onClick={() => setShowKeywords(v => !v)}
              className={cn(MICRO_LABEL, "mb-1.5 w-full justify-start gap-1.5 hover:text-foreground hover:no-underline [&_svg]:size-3")}
              data-testid="button-toggle-keywords"
            >
              <Hash />
              Mots-clés détectés
              {showKeywords ? <ChevronUp className="ml-auto" /> : <ChevronDown className="ml-auto" />}
            </Button>
            {showKeywords && (
              <div className="space-y-2">
                {[
                  { label: "Competences requises", items: report.detectedKeywords.requiredSkills, cls: "bg-destructive-soft text-destructive" },
                  { label: "Competences souhaitees", items: report.detectedKeywords.preferredSkills, cls: "bg-warning-soft text-warning-strong" },
                  { label: "Responsabilites", items: report.detectedKeywords.responsibilities, cls: "bg-primary-soft text-primary-strong" },
                  { label: "Domaine", items: report.detectedKeywords.keywords, cls: "bg-secondary text-muted-foreground" },
                ].filter(g => g.items?.length).map(g => (
                  <div key={g.label}>
                    <p className="mb-1 text-2xs uppercase tracking-wide text-muted-foreground/70">{g.label}</p>
                    <div className="flex flex-wrap gap-1">
                      {g.items.map((k: string, i: number) => (
                        <span key={i} className={cn("rounded-xs px-1.5 py-px text-2xs font-medium", g.cls)}>
                          {repairMojibake(k)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AsideDisclosure>
  );
}

// ── Library Suggestions ──

/* ══════════════════════════════════════════════════════════════════
   ENRICHMENT COACHING — Phase 1+3: contextual links to library
   Shows when primaryCause = proof_gap/bullets_too_generic and there
   are selected experiences with identifiable missing keywords.
   ══════════════════════════════════════════════════════════════════ */
function EnrichmentCoaching({ report, selectedExperienceIds, jobTitle }: {
  report: any;
  selectedExperienceIds?: string[] | null;
  jobTitle?: string;
}) {
  const primaryCause = report?.diagnosis?.primaryCause;
  const showCoaching = primaryCause === "proof_gap"
    || primaryCause === "bullets_too_generic"
    || primaryCause === "library_too_thin";
  if (!showCoaching) return null;

  const evidenceMissing: string[] = (report?.postRules?.evidenceKeywordsMissing || [])
    .map((kw: string) => repairMojibake(kw).trim())
    .filter(Boolean)
    .slice(0, 8);

  if (!evidenceMissing.length) return null;

  // Build experience-level coaching cards
  const selectedExps: Array<{
    title: string;
    company: string;
    matchedAspects: string[];
    experienceId?: string;
  }> = (report?.selectedExperiences || []).map((exp: any, i: number) => ({
    title: repairMojibake(exp.title || ""),
    company: repairMojibake(exp.company || ""),
    matchedAspects: (exp.matchedAspects || []).map((a: string) => a.toLowerCase()),
    experienceId: selectedExperienceIds?.[i] || undefined,
  }));

  // For each experience, find keywords it COULD cover but doesn't yet
  const coachingCards = selectedExps
    .filter(exp => exp.experienceId)
    .map(exp => {
      const missingForExp = evidenceMissing.filter(kw =>
        !exp.matchedAspects.some(a => a.includes(kw.toLowerCase()) || kw.toLowerCase().includes(a))
      );
      // Only show if there are missing keywords this experience could cover
      if (missingForExp.length === 0) return null;
      return { ...exp, missingKeywords: missingForExp.slice(0, 5) };
    })
    .filter(Boolean)
    .slice(0, 3); // Max 3 cards

  if (coachingCards.length === 0) return null;

  return (
    <AsideCard className="border-primary/20 bg-primary-soft/30" data-testid="section-enrichment-coaching">
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 shrink-0 text-primary-strong" />
          <h3 className="text-xs font-bold uppercase tracking-wide text-primary-strong">Renforcer tes expériences</h3>
        </div>
        <p className="text-2xs leading-relaxed text-muted-foreground">
          Ton profil colle, mais ces éléments manquent dans tes bullets. Enrichis directement l'expérience concernée.
        </p>
        <div className="space-y-2">
          {coachingCards.map((card: any) => {
            const params = new URLSearchParams({
              experienceId: card.experienceId,
              missing: card.missingKeywords.join(","),
              ...(jobTitle ? { jobTitle } : {}),
            });
            return (
              <Link key={card.experienceId} href={`/library?${params.toString()}`}>
                <div className="group cursor-pointer space-y-1.5 rounded-md border border-border/60 bg-card p-3 transition-colors hover:border-primary/40 hover:bg-primary-soft/20">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-foreground">{card.title} — {card.company}</p>
                    <span className="shrink-0 text-2xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">Enrichir &rarr;</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {card.missingKeywords.map((kw: string, i: number) => (
                      <Badge key={i} variant="warning" className="rounded-xs px-1.5">{kw}</Badge>
                    ))}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </AsideCard>
  );
}

function LibrarySuggestions({ missingSkills }: { missingSkills: string[] }) {
  const [added, setAdded] = useState<Set<string>>(new Set());

  const mutation = useMutation({
    mutationFn: (skill: string) =>
      apiRequest("POST", "/api/skills", { name: skill, level: null, priority: 0 }),
    onSuccess: (_: unknown, skill: string) => {
      setAdded(prev => new Set([...prev, skill]));
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
    },
  });

  if (!missingSkills.length) return null;

  return (
    <AsideCard className="border-warning/30 bg-warning-soft/40" data-testid="section-library-suggestions">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-3.5 shrink-0 text-warning" />
          <h3 className="text-xs font-bold uppercase tracking-wide text-warning-strong">Améliorer la bibliothèque</h3>
        </div>
        <p className="mb-3 text-2xs leading-relaxed text-muted-foreground">
          Ces compétences manquent dans votre Super-CV. Ajoutez-les en 1 clic pour améliorer vos prochains tailorings.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {missingSkills.slice(0, 12).map(skill => {
            const isAdded = added.has(skill);
            return (
              <Button
                key={skill}
                variant="outline"
                size="sm"
                data-testid={`button-add-skill-${skill}`}
                onClick={() => { if (!isAdded && !mutation.isPending) mutation.mutate(skill); }}
                disabled={isAdded || mutation.isPending}
                className={cn(
                  "h-6 min-h-0 gap-1 rounded-sm px-2 text-2xs [&_svg]:size-3",
                  isAdded
                    ? "border-success/40 bg-success-soft text-success-strong disabled:opacity-100"
                    : "border-border/60 bg-card hover:border-warning/60 hover:bg-warning-soft",
                )}
              >
                {isAdded ? <Check /> : <Plus className="text-warning" />}
                {repairMojibake(skill)}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </AsideCard>
  );
}

// ── Critical Keywords Coverage ──

function CriticalKeywordsCoverage({ covered, missing, injected }: { covered: string[]; missing: string[]; injected?: string[] }) {
  const [showAllCovered, setShowAllCovered] = useState(false);
  const [showAllMissing, setShowAllMissing] = useState(false);
  const COVERED_CAP = 8;
  const MISSING_CAP = 5;
  const total = covered.length + missing.length;
  if (total === 0) return null;
  const pct = Math.round((covered.length / total) * 100);
  const tone = scoreTone(pct);
  const visibleCovered = showAllCovered ? covered : covered.slice(0, COVERED_CAP);
  const visibleMissing = showAllMissing ? missing : missing.slice(0, MISSING_CAP);

  return (
    <div className="space-y-3" data-testid="section-critical-keywords">
      <div className="flex items-center justify-between">
        <h4 className={cn(MICRO_LABEL, "text-foreground")}>Keywords critiques</h4>
        <span className={cn("text-xs font-bold tabular-nums", TONE_TEXT[tone])}>{covered.length}/{total} dans le CV</span>
      </div>
      <ScoreBar value={pct} tone={tone} className="flex-none" />
      <div className="flex flex-wrap gap-1.5">
        {visibleCovered.map((k, i) => (
          <Badge key={i} variant="success">
            <Check /> {k}
          </Badge>
        ))}
        {!showAllCovered && covered.length > COVERED_CAP && (
          <Button variant="secondary" size="sm" onClick={() => setShowAllCovered(true)} className={CHIP_BUTTON}>
            +{covered.length - COVERED_CAP}
          </Button>
        )}
        {visibleMissing.map((k, i) => (
          <Badge key={i} variant="destructive" className="border border-destructive/20">
            <X /> {k}
          </Badge>
        ))}
        {!showAllMissing && missing.length > MISSING_CAP && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowAllMissing(true)}
            className={cn(CHIP_BUTTON, "border border-destructive/20 bg-destructive-soft text-destructive hover:bg-destructive-soft/70")}
          >
            +{missing.length - MISSING_CAP} manquants
          </Button>
        )}
      </div>
      {injected && injected.length > 0 && (
        <p className="text-2xs leading-relaxed text-muted-foreground">
          Injectés pour ATS : {injected.join(", ")}.
        </p>
      )}
    </div>
  );
}

type ReportDiagnosis = {
  primaryDiagnosis?: string;
  verdict?: string;
  whatMatches?: string[];
  whatMissing?: string[];
  nextActions?: string[];
  primaryCause?: DiagnosisCause;
  secondaryCauses?: DiagnosisCause[];
  recommendedAction?: string;
};

type JobInputInfo = {
  sourceType?: "url" | "text";
  normalizedUrl?: string;
  scrapeStatus?: "success" | "blocked" | "failed" | "not_attempted";
  scrapeQuality?: "good" | "uncertain" | "bad";
  scrapeMessage?: string;
};

function sourceBadge(meta?: JobInputInfo) {
  if (meta?.sourceType === "url") {
    return meta.scrapeStatus === "success" ? "URL scrapee" : "URL fournie";
  }
  return "Texte colle";
}

function scrapeQualityMeta(meta?: JobInputInfo) {
  switch (meta?.scrapeQuality) {
    case "good":
      return { label: "Scrape fiable", variant: "success" as BadgeVariant };
    case "uncertain":
      return { label: "Scrape a verifier", variant: "warning" as BadgeVariant };
    case "bad":
      return { label: "Scrape faible", variant: "destructive" as BadgeVariant };
    default:
      return null;
  }
}

function MatchDiagnosisCard({ score, diagnosis, fallbackUsed, scoreBreakdown }: { score: number; diagnosis?: ReportDiagnosis; fallbackUsed?: boolean; scoreBreakdown?: ReportScoreBreakdown }) {
  const [showDetail, setShowDetail] = useState(false);
  const displayScore = scoreBreakdown?.pertinence ?? scoreBreakdown?.fitOffer ?? score;
  const fitMeta = getFitLabel(displayScore);
  const badgeMeta = getBadgeMeta(scoreBreakdown?.badge);
  const credibilityMeta = getCredibilityMeta(scoreBreakdown?.recruiterCredibility);
  const scoreLabel = scoreBreakdown?.fitMetier != null ? "Pertinence" : "Fit offre";
  const primaryDiagnosis = repairMojibake(diagnosis?.primaryDiagnosis || "");
  const verdict = repairMojibake(diagnosis?.verdict || "Le moteur a estime un niveau de correspondance global pour cette annonce.");
  const whatMatches = (diagnosis?.whatMatches || []).map(item => repairMojibake(item));
  const whatMissing = (diagnosis?.whatMissing || []).map(item => repairMojibake(item));
  const nextActions = (diagnosis?.nextActions || []).map(item => repairMojibake(item));
  const primaryCause = getCauseLabel(diagnosis?.primaryCause);
  const secondaryCauses = (diagnosis?.secondaryCauses || []).map(cause => getCauseLabel(cause));
  const recommendedAction = repairMojibake(diagnosis?.recommendedAction || "");
  const optimizationNotes = (scoreBreakdown?.optimizationNotes || []).map(note => repairMojibake(note));
  const letterGrade = computeLetterGrade(scoreBreakdown, score);
  const warning = computeWarningBanner(scoreBreakdown, fallbackUsed);
  const hasDetail = whatMatches.length > 0 || whatMissing.length > 0 || nextActions.length > 0 || !!primaryCause || optimizationNotes.length > 0;

  const WARNING_CLASSES: Record<"error" | "warn" | "info", string> = {
    error: "border-destructive/20 bg-destructive-soft text-destructive",
    warn: "border-warning/30 bg-warning-soft text-warning-strong",
    info: "border-primary/20 bg-primary-soft/40 text-primary-strong",
  };
  const DETAIL_TILE = "space-y-1 rounded-md border border-border/60 bg-secondary/25 px-3 py-2.5";
  const DETAIL_ITEM = "flex items-start gap-2 text-xs leading-relaxed text-foreground/80";

  return (
    <AsideCard data-testid="section-match-diagnosis">
      <div className="flex flex-col gap-3 p-4">
        {/* Score hero */}
        <div className="flex items-center gap-4">
          <div title={scoreLabel}>
            <ScoreRing value={displayScore} size="md" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className={cn("text-base font-bold leading-5", fitMeta.textColor)}>{fitMeta.label}</p>
              {letterGrade && (
                <Badge variant={letterGrade.variant} className="font-bold" title={letterGrade.label}>
                  {letterGrade.grade}
                </Badge>
              )}
              {scoreBreakdown?.badge ? (
                <Badge variant={badgeMeta.variant} className="font-semibold">{badgeMeta.label}</Badge>
              ) : scoreBreakdown?.recruiterCredibility ? (
                <Badge variant={credibilityMeta.variant} className="font-semibold">{credibilityMeta.label}</Badge>
              ) : null}
            </div>
            {primaryDiagnosis && (
              <p className="text-sm font-medium text-foreground">{primaryDiagnosis}</p>
            )}
          </div>
        </div>

        {/* Verdict */}
        <p className="text-sm leading-5 text-foreground/80">{verdict}</p>

        {/* Consolidated warning — single line */}
        {warning && (
          <div className={cn("flex items-start gap-2 rounded-md border px-2.5 py-2 text-2xs font-medium leading-snug", WARNING_CLASSES[warning.severity])}>
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            {warning.message}
          </div>
        )}

        {/* Progressive disclosure toggle */}
        {hasDetail && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDetail(v => !v)}
            className="h-auto min-h-0 w-full justify-between px-0 py-1 text-xs font-normal hover:bg-transparent [&_svg]:size-3.5"
          >
            <span>{showDetail ? "Masquer l'analyse" : "Voir l'analyse"}</span>
            {showDetail ? <ChevronUp /> : <ChevronDown />}
          </Button>
        )}

        {/* Detail panel */}
        {showDetail && (
          <div className="space-y-3 border-t border-border/40 pt-3">
            {optimizationNotes.length > 0 && (
              <div className={DETAIL_TILE}>
                <p className={MICRO_LABEL}>Décision moteur</p>
                {optimizationNotes.slice(0, 2).map((note, i) => (
                  <p key={i} className="text-2xs leading-relaxed text-foreground/80">{note}</p>
                ))}
              </div>
            )}

            {primaryCause && (
              <div className={DETAIL_TILE}>
                <p className={MICRO_LABEL}>Cause principale</p>
                <p className="text-xs font-medium text-foreground">{primaryCause}</p>
                {secondaryCauses.length > 0 && (
                  <p className="text-2xs leading-relaxed text-muted-foreground">Causes secondaires : {secondaryCauses.join(", ")}.</p>
                )}
                {recommendedAction && (
                  <p className="text-2xs leading-relaxed text-foreground/80">Action recommandée : {recommendedAction}</p>
                )}
              </div>
            )}

            {whatMatches.length > 0 && (
              <div>
                <p className={cn(MICRO_LABEL, "mb-1.5")}>Ce qui matche</p>
                <ul className="space-y-1.5">
                  {whatMatches.slice(0, 4).map((item, i) => (
                    <li key={i} className={DETAIL_ITEM}>
                      <CheckCircle className="mt-0.5 size-3.5 shrink-0 text-success" />
                      {item}
                    </li>
                  ))}
                  {whatMatches.length > 4 && (
                    <li className="pl-5 text-2xs text-muted-foreground">+{whatMatches.length - 4} autre{whatMatches.length - 4 > 1 ? "s" : ""}</li>
                  )}
                </ul>
              </div>
            )}

            {whatMissing.length > 0 && (
              <div>
                <p className={cn(MICRO_LABEL, "mb-1.5")}>Ce qui manque</p>
                <ul className="space-y-1.5">
                  {whatMissing.slice(0, 4).map((item, i) => (
                    <li key={i} className={DETAIL_ITEM}>
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                      {item}
                    </li>
                  ))}
                  {whatMissing.length > 4 && (
                    <li className="pl-5 text-2xs text-muted-foreground">+{whatMissing.length - 4} autre{whatMissing.length - 4 > 1 ? "s" : ""}</li>
                  )}
                </ul>
              </div>
            )}

            {nextActions.length > 0 && (
              <div>
                <p className={cn(MICRO_LABEL, "mb-1.5")}>Quoi faire maintenant</p>
                <ul className="space-y-1.5">
                  {nextActions.slice(0, 3).map((item, i) => (
                    <li key={i} className={DETAIL_ITEM}>
                      <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-warning" />
                      {item}
                    </li>
                  ))}
                  {nextActions.length > 3 && (
                    <li className="pl-5 text-2xs text-muted-foreground">+{nextActions.length - 3} autre{nextActions.length - 3 > 1 ? "s" : ""}</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </AsideCard>
  );
}

const POSITIONING_DISPLAY: Record<string, string> = {
  ic: "IC / Craft",
  lead: "Lead",
  consultant: "Consultant",
  manager: "Manager",
};

type ParsedJobDisplay = {
  title: string;
  company: string;
  seniority?: string;
  domain?: string;
  positioning?: string;
  responsibilities: string[];
  requiredSkills: string[];
  criticalKeywords: string[];
  intentions: string[];
  language?: string;
};

function UsedJobPosting({
  meta,
  rawText,
  url,
  parsedJob,
}: {
  meta?: JobInputInfo;
  rawText?: string;
  url?: string;
  parsedJob?: ParsedJobDisplay;
}) {
  const hasParsed = Boolean(parsedJob && parsedJob.responsibilities.length > 0);
  const [showRaw, setShowRaw] = useState(false);
  const qualityMeta = scrapeQualityMeta(meta);
  const cleanedText = cleanJobPostingForAnalysis(rawText);
  const rawDisplay = trimBlock(rawText) || "Aucun texte d'annonce sauvegarde pour ce run.";
  const textDisplay = cleanedText || rawDisplay;
  const wasCleaned = Boolean(cleanedText) && cleanedText !== trimBlock(rawText);
  const mergedRequirements = Array.from(
    new Set([
      ...(parsedJob?.criticalKeywords || []).map(item => repairMojibake(item).trim()),
      ...(parsedJob?.requiredSkills || []).map(item => repairMojibake(item).trim()),
    ].filter(Boolean)),
  );

  const toggleButtonClass = "h-7 min-h-0 px-2.5 text-2xs";

  return (
    <div className="min-h-[300px] bg-card px-6 py-8 md:px-14 md:py-9" data-testid="section-used-job-posting">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant="primary" className="font-semibold">
          <Globe /> {sourceBadge(meta)}
        </Badge>
        {qualityMeta && (
          <Badge variant={qualityMeta.variant} className="font-semibold">{qualityMeta.label}</Badge>
        )}
        {meta?.scrapeStatus && (
          <span className="text-2xs text-muted-foreground">{repairMojibake(meta.scrapeMessage || "")}</span>
        )}
      </div>

      {(meta?.normalizedUrl || url) && (
        <div className="mb-4">
          <p className={cn(DOC_EYEBROW, "mb-2")}>Source</p>
          <a
            href={meta?.normalizedUrl || url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 break-all text-xs text-primary hover:underline"
          >
            <ExternalLink className="size-3" /> {meta?.normalizedUrl || url}
          </a>
        </div>
      )}

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className={DOC_EYEBROW}>Annonce utilisée</p>
          {hasParsed ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRaw(v => !v)}
              className={toggleButtonClass}
              data-testid="button-toggle-job-posting-raw"
            >
              {showRaw ? "Voir la synthèse" : "Voir le texte brut"}
            </Button>
          ) : wasCleaned ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRaw(v => !v)}
              className={toggleButtonClass}
              data-testid="button-toggle-job-posting-raw"
            >
              {showRaw ? "Voir nettoyée" : "Voir brut"}
            </Button>
          ) : null}
        </div>

        {/* Parsed structured view */}
        {hasParsed && !showRaw ? (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold leading-snug text-foreground">
                {parsedJob!.title}
                {parsedJob!.company && (
                  <span className="font-normal text-muted-foreground"> — {parsedJob!.company}</span>
                )}
              </h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {parsedJob!.seniority && (
                  <Badge variant="secondary" className="capitalize">{parsedJob!.seniority}</Badge>
                )}
                {parsedJob!.positioning && (
                  <Badge variant="secondary">{POSITIONING_DISPLAY[parsedJob!.positioning] || parsedJob!.positioning}</Badge>
                )}
                {parsedJob!.domain && (
                  <Badge variant="secondary">{parsedJob!.domain}</Badge>
                )}
                {parsedJob!.language && (
                  <Badge variant="secondary">{parsedJob!.language}</Badge>
                )}
              </div>
            </div>

            {parsedJob!.responsibilities.length > 0 && (
              <div>
                <p className={cn(DOC_EYEBROW, "mb-2")}>Missions</p>
                <ul className="space-y-1.5">
                  {parsedJob!.responsibilities.map((r, i) => (
                    <li key={i} className={cn(CV_BODY, "flex items-start gap-2.5 text-foreground/85")}>
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-primary/50" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {mergedRequirements.length > 0 && (
              <div>
                <p className={cn(DOC_EYEBROW, "mb-2")}>
                  Exigences de l'offre
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {mergedRequirements.map((item, index) => {
                    const isCritical = (parsedJob!.criticalKeywords || []).includes(item);
                    return (
                      <Badge key={`${item}-${index}`} variant={isCritical ? "primary" : "secondary"}>
                        {item}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}

            {parsedJob!.intentions.length > 0 && (
              <div>
                <p className={cn(DOC_EYEBROW, "mb-2")}>
                  Ce que le poste cherche vraiment
                </p>
                <ul className="space-y-1">
                  {parsedJob!.intentions.map((intent, i) => (
                    <li key={i} className={cn(CV_BODY, "flex items-start gap-2.5 italic text-foreground/70")}>
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/40" />
                      {intent}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          /* Raw / cleaned text fallback */
          <>
            {!showRaw && wasCleaned && !hasParsed && (
              <p className="mb-3 text-2xs text-muted-foreground">
                Texte nettoyé pour la lecture.
              </p>
            )}
            <div className="rounded-md border border-border/60 bg-secondary/25 p-4">
              <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground/85">
                {showRaw ? rawDisplay : textDisplay}
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function compactList(items: unknown, limit = 12): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function trimBlock(value: unknown): string {
  return repairMojibake(String(value ?? "")).trim();
}

function toCodeFence(label: string, value: unknown): string[] {
  const content = trimBlock(value) || "n/a";
  return [`## ${label}`, "```text", content.replace(/```/g, "'''"), "```"];
}

function findMarkerIndex(text: string, markers: RegExp[]): number {
  let bestIndex = -1;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (match && (bestIndex === -1 || match.index < bestIndex)) {
      bestIndex = match.index;
    }
  }
  return bestIndex;
}

function formatJobPostingLines(lines: string[]): string {
  const output: string[] = [];
  const metadata: string[] = [];
  const listSectionHeadings = new Set(["Vos responsabilites", "Vos responsabilités", "Profil", "Responsibilities", "Requirements", "Qualifications"]);
  let currentHeading = "";

  const pushLine = (value: string) => {
    const line = trimBlock(value);
    if (!line) return;
    if (output[output.length - 1] === line) return;
    output.push(line);
  };

  for (const rawLine of lines) {
    const line = trimBlock(rawLine);
    if (!line) continue;

    const metadataMatch = line.match(/^(Seniority level|Employment type|Job function|Industries)\s+(.+)$/i);
    if (metadataMatch) {
      metadata.push(`- ${metadataMatch[1]}: ${metadataMatch[2].trim()}`);
      continue;
    }

    const isHeading = /^(Votre mission|Vos responsabilites|Vos responsabilités|Profil|About the job|Responsibilities|Requirements|Qualifications)$/i.test(line);
    if (isHeading) {
      if (output.length > 0 && output[output.length - 1] !== "") output.push("");
      currentHeading = line;
      pushLine(line);
      output.push("");
      continue;
    }

    if (listSectionHeadings.has(currentHeading)) {
      pushLine(line.startsWith("- ") ? line : `- ${line}`);
      continue;
    }

    pushLine(line);
  }

  while (output[output.length - 1] === "") output.pop();

  if (metadata.length > 0) {
    if (output.length > 0) output.push("");
    output.push("Infos LinkedIn");
    output.push("");
    output.push(...metadata);
  }

  return output
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanJobPostingForAnalysis(rawText: unknown): string {
  const text = trimBlock(rawText);
  if (!text) return "";

  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  const startMarkers = [
    /(?:^|\n)Chez\s+[^\n]+/i,
    /(?:^|\n)Nous recherchons\b/i,
    /(?:^|\n)Votre mission\b/i,
    /(?:^|\n)Vos responsabilites\b/i,
    /(?:^|\n)Vos responsabilités\b/i,
    /(?:^|\n)Profil\b/i,
    /(?:^|\n)Le poste\b/i,
    /(?:^|\n)Descriptif du poste\b/i,
    /(?:^|\n)About the job\b/i,
    /(?:^|\n)Job description\b/i,
    /(?:^|\n)Responsibilities\b/i,
  ];
  const endMarkers = [
    /\n(?:Referrals increase|Get notified about new|Similar jobs|People also viewed|Show more jobs like this|Show fewer jobs like this)\b/i,
    /\n(?:Assistant Designer|ALTERNANCE PRODUCT DESIGNER|Designer produit|UX\/UI designer)\b/i,
  ];

  let cleaned = normalized;
  const startIndex = findMarkerIndex(normalized, startMarkers);
  if (startIndex >= 0) {
    cleaned = normalized.slice(startIndex).trim();
  }

  const endIndex = findMarkerIndex(cleaned, endMarkers);
  if (endIndex >= 0) {
    cleaned = cleaned.slice(0, endIndex).trim();
  }

  const noiseLinePatterns = [
    /^s a list of search options/i,
    /^Jobs$/i,
    /^People$/i,
    /^Learning$/i,
    /^Clear text$/i,
    /^Sign in Join now$/i,
    /^Apply$/i,
    /^Join or sign in to find your next job$/i,
    /^Join to apply\b/i,
    /^Email or phone$/i,
    /^Password$/i,
    /^Show$/i,
    /^Forgot password\?$/i,
    /^Sign in$/i,
    /^Sign in with Email$/i,
    /^or$/i,
    /^New to LinkedIn\? Join now$/i,
    /^By clicking Continue to join or sign in/i,
    /^Save$/i,
    /^Report this job$/i,
    /^See who .+ has hired for this role$/i,
    /^Be among the first \d+ applicants$/i,
    /^Show more$/i,
    /^Show less$/i,
    /^\d+\s+(?:hours?|days?|weeks?|months?)\s+ago$/i,
    /^Blah blah blah Cookie/i,
    /^Axeptio consent/i,
    /^Consentements certifies/i,
    /^Plateforme de Gestion du Consentement/i,
    /^Trouver un job$/i,
    /^Trouver une entreprise$/i,
    /^Media$/i,
    /^Employeurs$/i,
    /^Candidatures$/i,
    /^Opportunites$/i,
    /^Se connecter$/i,
    /^Retour$/i,
    /^Partager$/i,
    /^Postuler$/i,
    /^Sauvegarder$/i,
    /^Non merci$/i,
    /^Je choisis$/i,
    /^OK pour moi$/i,
    /^Questions et reponses sur l'offre$/i,
    /^Questions et réponses sur l'offre$/i,
    /^L'envoi d'un CV/i,
    /^Le teletravail est-il possible/i,
    /^Quel est le type de contrat/i,
    /^Une lettre de motivation est-elle obligatoire/i,
    /^Voir plus$/i,
    /^Envie d'en savoir plus \?$/i,
  ];

  const filteredLines = cleaned
    .replace(/^(?:Blah blah blah Cookie ![\s\S]*?)?(?=(?:Chez|Nous recherchons|Votre mission|Le poste|Descriptif du poste|About the job|Job description))/i, "")
    .replace(/Axeptio consent[\s\S]*?(?=\n(?:Chez|Nous recherchons|Votre mission|Le poste|Descriptif du poste|About the job|Job description)\b)/i, "")
    .replace(/\n(?:Questions et reponses sur l'offre|Cette offre vous tente \?|Postuler|Sauvegarder)\b[\s\S]*?(?=\n(?:Chez|Nous recherchons|Votre mission|Le poste|Descriptif du poste))/i, "\n")
    .split("\n")
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false;
      return !noiseLinePatterns.some(pattern => pattern.test(line));
    })
    .filter((line, index, lines) => line !== lines[index - 1]);

  return formatJobPostingLines(filteredLines);
}

function buildAnalysisPayload({
  run,
  report,
  jobInput,
  pageTitle,
}: {
  run: any;
  report: any;
  jobInput: JobInputInfo;
  pageTitle: string;
}) {
  const selectedExperiences = Array.isArray(report?.selectedExperiences) ? report.selectedExperiences : [];
  const selectedBullets = Array.isArray(report?.selectedBullets) ? report.selectedBullets : [];

  const sourceExperiences = selectedExperiences.map((exp: any) => ({
    title: trimBlock(exp?.title) || "Experience",
    company: trimBlock(exp?.company) || "",
    bullets: selectedBullets
      .filter((bullet: any) => bullet.experienceTitle === exp.title)
      .map((bullet: any) => trimBlock(bullet?.text))
      .filter(Boolean),
  })).filter((exp: { bullets: string[] }) => exp.bullets.length > 0);

  return {
    meta: {
      runId: trimBlock(run?.id),
      title: trimBlock(pageTitle) || "Tailored CV",
      mode: trimBlock(run?.mode) || "unknown",
      language: trimBlock(report?.detectedLanguage) || "unknown",
      seniority: trimBlock(report?.jobSeniority) || "unknown",
    },
    match: {
      confidence: report?.confidence ?? null,
      fitOffer: report?.scoreBreakdown?.fitOffer ?? report?.confidence ?? null,
      pertinence: report?.scoreBreakdown?.pertinence ?? null,
      fitMetier: report?.scoreBreakdown?.fitMetier ?? null,
      fitNiveauFactor: report?.scoreBreakdown?.fitNiveauFactor ?? null,
      fitNiveau: trimBlock(report?.scoreBreakdown?.fitNiveau) || null,
      forcePreuve: report?.scoreBreakdown?.forcePreuve ?? null,
      credibiliteCv: report?.scoreBreakdown?.credibiliteCv ?? null,
      evidenceGrounding: report?.scoreBreakdown?.evidenceGrounding ?? null,
      recruiterCredibilityScore: report?.scoreBreakdown?.recruiterCredibilityScore ?? null,
      atsReadiness: report?.scoreBreakdown?.atsReadiness ?? null,
      overstatementRisk: report?.scoreBreakdown?.overstatementRisk ?? null,
      badge: trimBlock(report?.scoreBreakdown?.badge) || "n/a",
      distanceDomain: trimBlock(report?.scoreBreakdown?.distanceDomain) || null,
      hardWarnings: compactList(report?.scoreBreakdown?.hardWarnings, 8),
      textIntegrityScore: report?.scoreBreakdown?.textIntegrityScore ?? null,
      optimizationDecision: trimBlock(report?.scoreBreakdown?.optimizationDecision) || null,
      optimizationNotes: compactList(report?.scoreBreakdown?.optimizationNotes, 4),
      variantStrategy: trimBlock(report?.scoreBreakdown?.variantStrategy) || null,
      scoreModel: trimBlock(report?.scoreBreakdown?.scoreModel) || null,
      primaryDiagnosis: trimBlock(report?.diagnosis?.primaryDiagnosis) || "n/a",
      verdict: trimBlock(report?.diagnosis?.verdict || report?.confidenceReasoning) || "n/a",
      atsScore: report?.scoreBreakdown?.ats ?? null,
      atsOptimizedScore: report?.scoreBreakdown?.atsOptimized ?? null,
      atsBoost: report?.scoreBreakdown?.atsBoost ?? null,
      contextSupport: report?.scoreBreakdown?.contextSupport ?? null,
      semanticScore: report?.scoreBreakdown?.semantic ?? null,
      recruiterCredibility: trimBlock(report?.scoreBreakdown?.recruiterCredibility) || "n/a",
      domainMismatch: trimBlock(report?.scoreBreakdown?.domainMismatch) || null,
      cappedByKeywords: Boolean(report?.scoreBreakdown?.cappedByKeywords),
      cappedByEvidence: Boolean(report?.scoreBreakdown?.cappedByEvidence),
      fallbackUsed: Boolean(report?.fallbackUsed),
    },
    diagnosis: {
      primaryCause: trimBlock(report?.diagnosis?.primaryCause) || "n/a",
      secondaryCauses: compactList(report?.diagnosis?.secondaryCauses, 6),
      recommendedAction: trimBlock(report?.diagnosis?.recommendedAction) || "n/a",
      whatMatches: compactList(report?.diagnosis?.whatMatches, 8),
      whatMissing: compactList(report?.diagnosis?.whatMissing, 8),
      nextActions: compactList(report?.diagnosis?.nextActions, 8),
      tips: compactList(report?.tips, 8),
    },
    coverage: {
      matchedSkills: compactList(report?.matchedSkills, 20),
      missingSkills: compactList(report?.missingSkills, 20),
      keywordsCovered: compactList(report?.postRules?.keywordsCovered, 25),
      keywordsMissing: compactList(report?.postRules?.keywordsMissing, 25),
      evidenceKeywordsCovered: compactList(report?.postRules?.evidenceKeywordsCovered, 25),
      evidenceKeywordsMissing: compactList(report?.postRules?.evidenceKeywordsMissing, 25),
      injectedKeywords: compactList(report?.postRules?.injectedKeywords, 25),
    },
    jobInput: {
      sourceType: jobInput?.sourceType || "unknown",
      scrapeStatus: jobInput?.scrapeStatus || "unknown",
      scrapeQuality: jobInput?.scrapeQuality || "unknown",
      scrapeMessage: trimBlock(jobInput?.scrapeMessage) || "n/a",
      normalizedUrl: trimBlock(jobInput?.normalizedUrl || run?.jobPost?.url) || "n/a",
    },
    jobAnalysis: {
      positioning: trimBlock(report?.positioning) || "unknown",
      intentions: compactList(report?.intentions, 8),
      requiredSkills: compactList(report?.detectedKeywords?.requiredSkills, 12),
      preferredSkills: compactList(report?.detectedKeywords?.preferredSkills, 12),
      responsibilities: compactList(report?.detectedKeywords?.responsibilities, 10),
      criticalKeywords: compactList(report?.detectedKeywords?.criticalKeywords, 10),
    },
    selectionDebug: {
      selectedExperiences: (Array.isArray(report?.selectedExperiences) ? report.selectedExperiences : []).map((exp: any) => ({
        title: trimBlock(exp?.title) || "Experience",
        company: trimBlock(exp?.company) || "",
        score: exp?.score ?? null,
        reason: trimBlock(exp?.reason) || "n/a",
        matchedAspects: compactList(exp?.matchedAspects, 8),
        bulletCount: exp?.bulletCount ?? 0,
        charBudget: exp?.charBudget ?? null,
      })),
      selectedBullets: (Array.isArray(report?.selectedBullets) ? report.selectedBullets : []).map((bullet: any) => ({
        experienceTitle: trimBlock(bullet?.experienceTitle) || "Experience",
        text: trimBlock(bullet?.text),
        totalScore: bullet?.score ?? null,
        deterministicScore: bullet?.deterministicScore ?? null,
        llmScore: bullet?.llmScore ?? null,
        dimension: trimBlock(bullet?.dimension) || "unknown",
        matchedKeywords: compactList(bullet?.matchedKeywords, 8),
      })),
      unavailable: [
        "Rejected bullets are not saved in the current run payload.",
        "Source-to-generated reformulation diff is not saved explicitly.",
      ],
    },
    sourceExperiences,
  };
}

function buildAnalysisExport({
  run,
  report,
  jobInput,
  displayText,
  pageTitle,
}: {
  run: any;
  report: any;
  jobInput: JobInputInfo;
  displayText: string;
  pageTitle: string;
}) {
  const payload = buildAnalysisPayload({ run, report, jobInput, pageTitle });
  const cleanedJobPosting = cleanJobPostingForAnalysis(run?.jobPost?.rawText);

  const sourceSections = payload.sourceExperiences.length
    ? payload.sourceExperiences.flatMap((exp: { title: string; company: string; bullets: string[] }) => [
        `### ${[exp.title, exp.company].filter(Boolean).join(" | ")}`,
        ...exp.bullets.map((bullet: string) => `- ${bullet}`),
        "",
      ])
    : ["No source bullets saved for this run."];

  const experienceDebugSections = payload.selectionDebug.selectedExperiences.length
    ? payload.selectionDebug.selectedExperiences.flatMap((exp: {
        title: string;
        company: string;
        score: number | null;
        reason: string;
        matchedAspects: string[];
        bulletCount: number;
        charBudget: number | null;
      }) => [
        `### ${[exp.title, exp.company].filter(Boolean).join(" | ")}`,
        `- score: ${exp.score ?? "n/a"}`,
        `- reason: ${exp.reason}`,
        `- matched aspects: ${exp.matchedAspects.join(", ") || "none"}`,
        `- selected bullets: ${exp.bulletCount}`,
        `- char budget: ${exp.charBudget ?? "n/a"}`,
        "",
      ])
    : ["No selected experience debug saved for this run."];

  const bulletDebugSections = payload.selectionDebug.selectedBullets.length
    ? payload.selectionDebug.selectedBullets.map((bullet: {
        experienceTitle: string;
        text: string;
        totalScore: number | null;
        deterministicScore: number | null;
        llmScore: number | null;
        dimension: string;
        matchedKeywords: string[];
      }) => [
        `- [${bullet.experienceTitle}] total=${bullet.totalScore ?? "n/a"} det=${bullet.deterministicScore ?? "n/a"} llm=${bullet.llmScore ?? "n/a"} dim=${bullet.dimension} kw=${bullet.matchedKeywords.join(", ") || "none"}`,
        `  ${bullet.text || "n/a"}`,
      ].join("\n"))
    : ["No selected bullet debug saved for this run."];

  const lines = [
    "# CV-TAI REVIEW PACK",
    "",
    "> Share this block directly with ChatGPT or Claude for result analysis.",
    "",
    "## Snapshot",
    `- Run ID: ${payload.meta.runId || "unknown"}`,
    `- Title: ${payload.meta.title}`,
    `- Mode: ${payload.meta.mode}`,
    `- Language: ${payload.meta.language}`,
    `- Seniority: ${payload.meta.seniority}`,
    "",
    "## Match",
    `- Pertinence score: ${payload.match.pertinence ?? "n/a"}%`,
    `- Fit metier: ${payload.match.fitMetier ?? "n/a"}%`,
    `- Force de preuve: ${payload.match.forcePreuve ?? "n/a"}%`,
    `- Credibilite CV: ${payload.match.credibiliteCv ?? "n/a"}%`,
    `- Badge document: ${payload.match.badge || "n/a"}`,
    `- Distance domaine: ${payload.match.distanceDomain || "n/a"}`,
    `- Fit niveau: ${payload.match.fitNiveau || "n/a"}`,
    `- Score model: ${payload.match.scoreModel || "n/a"}`,
    `- Fit offer legacy: ${payload.match.fitOffer ?? "n/a"}%`,
    `- ATS score: ${payload.match.atsScore ?? "n/a"}`,
    `- ATS final score: ${payload.match.atsOptimizedScore ?? "n/a"}`,
    `- Recruiter credibility: ${payload.match.recruiterCredibility || "n/a"}`,
    `- Confidence (legacy): ${payload.match.confidence ?? "n/a"}%`,
    `- Primary diagnosis: ${payload.match.primaryDiagnosis}`,
    `- Verdict: ${payload.match.verdict}`,
    `- ATS boost from optimization: ${payload.match.atsBoost ?? "n/a"}`,
    `- Mission context support: ${payload.match.contextSupport ?? "n/a"}`,
    `- Semantic score: ${payload.match.semanticScore ?? "n/a"}`,
    `- Domain mismatch: ${payload.match.domainMismatch || "none"}`,
    `- Keywords capped: ${payload.match.cappedByKeywords ? "yes" : "no"}`,
    `- Evidence capped: ${payload.match.cappedByEvidence ? "yes" : "no"}`,
    `- Fallback used: ${payload.match.fallbackUsed ? "yes" : "no"}`,
    `- Primary cause: ${payload.diagnosis.primaryCause}`,
    `- Secondary causes: ${payload.diagnosis.secondaryCauses.join(", ") || "none"}`,
    `- Recommended action: ${payload.diagnosis.recommendedAction}`,
    "",
    "## What Matches",
    ...(payload.diagnosis.whatMatches.length ? payload.diagnosis.whatMatches.map(item => `- ${item}`) : ["- n/a"]),
    "",
    "## What Is Missing",
    ...(payload.diagnosis.whatMissing.length ? payload.diagnosis.whatMissing.map(item => `- ${item}`) : ["- n/a"]),
    "",
    "## Next Actions",
    ...(payload.diagnosis.nextActions.length ? payload.diagnosis.nextActions.map(item => `- ${item}`) : ["- n/a"]),
    "",
    "## Coverage",
    `- Matched skills: ${payload.coverage.matchedSkills.join(", ") || "none"}`,
    `- Missing skills: ${payload.coverage.missingSkills.join(", ") || "none"}`,
    `- Covered keywords: ${payload.coverage.keywordsCovered.join(", ") || "none"}`,
    `- Missing keywords: ${payload.coverage.keywordsMissing.join(", ") || "none"}`,
    `- Evidence keywords covered: ${payload.coverage.evidenceKeywordsCovered.join(", ") || "none"}`,
    `- Evidence keywords missing: ${payload.coverage.evidenceKeywordsMissing.join(", ") || "none"}`,
    `- Injected keywords: ${payload.coverage.injectedKeywords.join(", ") || "none"}`,
    "",
    "## Job Input",
    `- Source type: ${payload.jobInput.sourceType}`,
    `- Scrape status: ${payload.jobInput.scrapeStatus}`,
    `- Scrape quality: ${payload.jobInput.scrapeQuality}`,
    `- Scrape message: ${payload.jobInput.scrapeMessage}`,
    `- Source URL: ${payload.jobInput.normalizedUrl}`,
    "",
    "## Job Analysis",
    `- Positioning: ${payload.jobAnalysis.positioning}`,
    `- Intentions: ${payload.jobAnalysis.intentions.join(" | ") || "none"}`,
    `- Required skills: ${payload.jobAnalysis.requiredSkills.join(", ") || "none"}`,
    `- Preferred skills: ${payload.jobAnalysis.preferredSkills.join(", ") || "none"}`,
    `- Responsibilities: ${payload.jobAnalysis.responsibilities.join(" | ") || "none"}`,
    `- Critical keywords: ${payload.jobAnalysis.criticalKeywords.join(", ") || "none"}`,
    "",
    "## Tips",
    ...(payload.diagnosis.tips.length ? payload.diagnosis.tips.map(item => `- ${item}`) : ["- n/a"]),
    "",
    "## Source Bullets",
    ...sourceSections,
    "## Selection Debug - Experiences",
    ...experienceDebugSections,
    "## Selection Debug - Bullets",
    ...bulletDebugSections,
    "",
    "## Selection Debug - Unavailable",
    ...payload.selectionDebug.unavailable.map(item => `- ${item}`),
    "",
    ...toCodeFence("Generated CV", displayText),
    "",
    ...toCodeFence("Used Job Posting", cleanedJobPosting || run?.jobPost?.rawText),
    "",
    "## Compact JSON",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ];

  return repairMojibake(lines.join("\n"));
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ── Application Tracker ──

interface AppTracking {
  applied: boolean;
  appliedAt: string;
  status: "waiting" | "interview" | "rejected" | "offer";
  responseAt: string;
}

const TRACKING_DEFAULT: AppTracking = { applied: false, appliedAt: "", status: "waiting", responseAt: "" };

const STATUS_OPTIONS: { value: AppTracking["status"]; label: string; activeClass: string }[] = [
  { value: "waiting",   label: "En attente", activeClass: "border-border bg-secondary text-foreground" },
  { value: "interview", label: "Entretien",  activeClass: "border-success/40 bg-success-soft text-success-strong" },
  { value: "rejected",  label: "Refus",      activeClass: "border-destructive/30 bg-destructive-soft text-destructive" },
];

function ApplicationTrackerSafe({ runId, initialTracking }: { runId: string; initialTracking?: AppTracking | null }) {
  const [tracking, setTracking] = useState<AppTracking>(() => {
    // Prefer DB value, then localStorage migration, then default
    if (initialTracking && initialTracking.applied) return initialTracking;
    try {
      const local = JSON.parse(localStorage.getItem(`app-tracking-${runId}`) || "null");
      if (local && local.applied) return local;
    } catch {}
    return TRACKING_DEFAULT;
  });

  const save = (updates: Partial<AppTracking>) => {
    const next = { ...tracking, ...updates };
    setTracking(next);
    // Persist to DB (fire-and-forget)
    fetch(`/api/runs/${runId}/tracking`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tracking: next }),
      credentials: "include",
    }).catch(() => {});
    // Keep localStorage as fallback
    localStorage.setItem(`app-tracking-${runId}`, JSON.stringify(next));
  };

  const today = new Date().toISOString().split("T")[0];

  const dateInputClass = "cursor-pointer border-b border-dashed border-muted-foreground/30 bg-transparent text-xs text-muted-foreground outline-none";

  return (
    <div className="space-y-3" data-testid="section-application-tracker">
      {!tracking.applied ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Tu as postulé avec ce CV ?</p>
          <Button size="sm" variant="outline" className="w-full" onClick={() => save({ applied: true, appliedAt: today })}>
            <Check /> J'ai postulé
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2.5">
            <span className="flex items-center gap-1 text-xs font-medium text-success-strong">
              <Check className="size-3" /> Postulé
            </span>
            <input
              type="date"
              value={tracking.appliedAt}
              onChange={e => save({ appliedAt: e.target.value })}
              className={dateInputClass}
            />
          </div>

          <div>
            <p className={cn(MICRO_LABEL, "mb-2")}>Réponse reçue</p>
            <div className="grid grid-cols-3 gap-1">
              {STATUS_OPTIONS.map(opt => (
                <Button
                  key={opt.value}
                  variant="outline"
                  size="sm"
                  onClick={() => save({ status: opt.value })}
                  className={cn(
                    "min-h-7 px-1 py-1.5 text-2xs",
                    tracking.status === opt.value ? opt.activeClass : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          {(tracking.status === "interview" || tracking.status === "rejected") && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="size-3" /> Date réponse
              </span>
              <input
                type="date"
                value={tracking.responseAt}
                onChange={e => save({ responseAt: e.target.value })}
                className={dateInputClass}
              />
            </div>
          )}

          <Button
            variant="link"
            onClick={() => save(TRACKING_DEFAULT)}
            className="mt-1 text-2xs text-muted-foreground/60 hover:text-muted-foreground"
          >
            Réinitialiser
          </Button>
        </div>
      )}
    </div>
  );
}

function TabbedCoveragePanel({
  covered, missing, injected, matchedSkills, missingSkills, tips, insight,
}: {
  covered: string[]; missing: string[]; injected?: string[];
  matchedSkills: string[]; missingSkills: string[];
  tips: string[]; insight?: string;
}) {
  const hasKeywords = covered.length > 0 || missing.length > 0;
  const hasSkills = matchedSkills.length > 0 || missingSkills.length > 0;
  const hasTips = tips.length > 0 || !!insight;
  if (!hasKeywords && !hasSkills && !hasTips) return null;

  return (
    <AsideCard className="overflow-hidden" data-testid="section-coverage-panel">
      <Tabs defaultValue={hasKeywords ? "keywords" : hasSkills ? "skills" : "conseils"}>
        <TabsList className="h-auto w-full rounded-none border-b border-border/60 bg-secondary/30 p-1">
          {hasKeywords && <TabsTrigger value="keywords" className="h-7 flex-1">Mots-clés</TabsTrigger>}
          {hasSkills && <TabsTrigger value="skills" className="h-7 flex-1">Skills</TabsTrigger>}
          {hasTips && <TabsTrigger value="conseils" className="h-7 flex-1">Conseils</TabsTrigger>}
        </TabsList>
        {hasKeywords && (
          <TabsContent value="keywords" className="mt-0 p-4">
            <CriticalKeywordsCoverage covered={covered} missing={missing} injected={injected} />
          </TabsContent>
        )}
        {hasSkills && (
          <TabsContent value="skills" className="mt-0 p-4">
            <SkillsCoverage matched={matchedSkills} missing={missingSkills} />
          </TabsContent>
        )}
        {hasTips && (
          <TabsContent value="conseils" className="mt-0 p-4">
            <KeyTips tips={tips} insight={insight} />
          </TabsContent>
        )}
      </Tabs>
    </AsideCard>
  );
}

export default function Result() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { data: run, isLoading, error } = useRun(id || "");
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);

  const displayText = repairMojibake(editedText ?? run?.outputCvText ?? "");

  const handleCopy = () => {
    navigator.clipboard.writeText(displayText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartEdit = () => {
    setEditedText(run?.outputCvText ?? "");
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setEditedText(null);
    setIsEditing(false);
  };

  const handleTailorAgain = () => {
    const jobText = run?.jobPost?.rawText;
    const jobUrl = run?.jobPost?.url;
    window.history.pushState({ tailorPrefill: { text: jobText, url: jobUrl } }, "", "/tailor");
    setLocation("/tailor");
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <div className="size-16 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
          <h2 className="text-xl font-semibold text-muted-foreground animate-pulse" data-testid="text-loading">Génération du CV en cours…</h2>
        </div>
      </Layout>
    );
  }

  if (error || !run) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center max-w-md mx-auto gap-4">
          <AlertCircle className="size-12 text-destructive" />
          <h2 className="text-2xl font-bold text-foreground" data-testid="text-error-title">Résultat introuvable</h2>
          <p className="text-muted-foreground" data-testid="text-error-message">Ce CV a peut-être été supprimé ou une erreur s'est produite.</p>
          <Link href="/tailor"><Button data-testid="button-try-again">Réessayer</Button></Link>
        </div>
      </Layout>
    );
  }

  const report = run.outputReportJson as any;
  const safeDiagnosis = report?.diagnosis ? {
    ...report.diagnosis,
    primaryDiagnosis: repairMojibake(report.diagnosis.primaryDiagnosis || ""),
    verdict: repairMojibake(report.diagnosis.verdict || ""),
    whatMatches: (report.diagnosis.whatMatches || []).map((item: string) => repairMojibake(item)),
    whatMissing: (report.diagnosis.whatMissing || []).map((item: string) => repairMojibake(item)),
    nextActions: (report.diagnosis.nextActions || []).map((item: string) => repairMojibake(item)),
    recommendedAction: repairMojibake(report.diagnosis.recommendedAction || ""),
  } : undefined;
  const jobInput = ((run.jobPost?.extractedJson as any)?.jobInput || {
    sourceType: run.jobPost?.url ? "url" : "text",
    normalizedUrl: run.jobPost?.url,
    scrapeStatus: run.jobPost?.url ? "success" : "not_attempted",
    scrapeQuality: "good",
    scrapeMessage: run.jobPost?.url ? "Annonce recuperee pour ce run." : "Description collee manuellement.",
  }) as JobInputInfo;
  const parsedJob: ParsedJobDisplay | undefined = (() => {
    const unique = (items: unknown) => Array.from(new Set(
      (Array.isArray(items) ? items : [])
        .map(item => repairMojibake(String(item ?? "")).trim())
        .filter(Boolean)
    ));

    const candidate: ParsedJobDisplay = {
      title: repairMojibake(report?.jobTitle || ""),
      company: repairMojibake(report?.jobCompany || ""),
      seniority: repairMojibake(report?.jobSeniority || ""),
      domain: repairMojibake(report?.jobDomain || ""),
      positioning: repairMojibake(report?.positioning || ""),
      responsibilities: unique(report?.detectedKeywords?.responsibilities),
      requiredSkills: unique(report?.detectedKeywords?.requiredSkills),
      criticalKeywords: unique(report?.detectedKeywords?.criticalKeywords),
      intentions: unique(report?.intentions),
      language: repairMojibake(report?.detectedLanguage || ""),
    };

    const hasContent =
      Boolean(candidate.title) ||
      Boolean(candidate.company) ||
      candidate.responsibilities.length > 0 ||
      candidate.requiredSkills.length > 0 ||
      candidate.criticalKeywords.length > 0 ||
      candidate.intentions.length > 0;

    return hasContent ? candidate : undefined;
  })();
  const modeMeta = MODE_META[run.mode] || MODE_META.polished;

  const pageTitle = repairMojibake([report?.jobTitle, report?.jobCompany].filter(Boolean).join(" - ") || "Tailored CV");
  const keyInsight = repairMojibake(report?.confidenceReasoning || "") || null;
  const fitOffer = report?.scoreBreakdown?.fitOffer ?? report?.confidence;
  const displayScore = report?.scoreBreakdown?.pertinence ?? fitOffer;
  const scoreLabel = report?.scoreBreakdown?.fitMetier != null ? "Pertinence" : "Fit offre";
  const jobUrl = run?.jobPost?.url;
  const allKeywords = [
    ...(report?.detectedKeywords?.requiredSkills || []),
    ...(report?.detectedKeywords?.preferredSkills || []),
    ...(report?.detectedKeywords?.keywords || []),
  ].filter((k, i, arr) => k.length > 2 && arr.indexOf(k) === i);
  const analysisExport = buildAnalysisExport({
    run,
    report,
    jobInput,
    displayText,
    pageTitle,
  });

  const handleExportAnalysis = async () => {
    const safeTitle = (pageTitle || "tailoring-review")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "tailoring-review";

    try {
      await navigator.clipboard.writeText(analysisExport);
    } catch {}

    downloadTextFile(`${safeTitle}-${run.id}.md`, analysisExport);
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  };

  const headerFit = displayScore != null ? getFitLabel(displayScore) : null;
  const toolbarClass = "flex flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary/30 px-4 py-2.5";

  return (
    <Layout>
      <div className="flex flex-col gap-6 animate-in fade-in duration-300">

        {/* ── PAGE HEADER ── */}
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_384px]" data-testid="section-page-header">
          {/* Gauche : back + score + titre */}
          <div className="flex min-w-0 items-start gap-4">
            <Link href="/history">
              <Button variant="outline" size="icon" className="shrink-0" aria-label="Retour" data-testid="button-back">
                <ArrowLeft />
              </Button>
            </Link>

            {displayScore != null && headerFit && (
              <div className="flex shrink-0 flex-col items-center gap-1" data-testid="section-confidence-ring">
                <ScoreRing value={displayScore} size="lg" valueTestId="text-confidence-value" />
                <div className="flex flex-col items-center">
                  <span className={cn("text-2xs font-semibold tracking-tight", headerFit.textColor)} data-testid="text-confidence-label">
                    {headerFit.label}
                  </span>
                  <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Pertinence
                  </span>
                </div>
              </div>
            )}

            <div className="min-w-0 flex-1 space-y-1 pt-1">
              <h1
                className="text-xl font-extrabold leading-tight tracking-tight text-foreground"
                data-testid="text-page-title"
              >
                {pageTitle}
              </h1>
              {safeDiagnosis?.primaryDiagnosis && (
                <p className="text-sm text-muted-foreground">
                  {repairMojibake(safeDiagnosis.primaryDiagnosis)}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge variant={modeMeta.variant} className="font-semibold" data-testid="badge-mode">
                  {modeMeta.icon} {modeMeta.label}
                </Badge>
                {report?.detectedLanguage && (
                  <Badge variant="primary" className="font-semibold" data-testid="badge-language">
                    <Globe /> {repairMojibake(report.detectedLanguage)}
                  </Badge>
                )}
                {report?.jobSeniority && (
                  <Badge variant="secondary">{repairMojibake(report.jobSeniority)}</Badge>
                )}
                {jobUrl && (
                  <a
                    href={jobUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(badgeVariants({ variant: "outline" }), "transition-colors hover:text-foreground")}
                    data-testid="link-job-posting"
                  >
                    <ExternalLink /> Voir l'annonce
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Droite : Suivi de candidature — largeur = colonne aside */}
          <Card variant="tint" className="flex items-start justify-between gap-3 rounded-md px-4 pb-4 pt-3">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-semibold tracking-tight text-foreground">Suivi de candidature</p>
              <ApplicationTrackerSafe
                runId={run.id}
                initialTracking={(run as any).tracking as AppTracking | null}
              />
            </div>
            <Mascot variant="thinking" className="size-[94px] shrink-0" />
          </Card>
        </div>

        {/* ── MAIN GRID ── */}
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_384px]">

          {/* CENTER: CV Document */}
          <Card variant="document" className="flex min-w-0 flex-col overflow-hidden" data-testid="section-cv-panel">
            {!isEditing ? (
              <Tabs defaultValue="generated">
                <div className={toolbarClass}>
                  <TabsList className="h-auto max-w-full flex-wrap justify-start bg-card/70 sm:h-8">
                    <TabsTrigger value="generated" data-testid="tab-generated">CV généré</TabsTrigger>
                    <TabsTrigger value="source" data-testid="tab-source">Super CV utilisé</TabsTrigger>
                    <TabsTrigger value="job" data-testid="tab-job">Annonce utilisée</TabsTrigger>
                  </TabsList>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleStartEdit}
                    data-testid="button-edit-cv"
                  >
                    <Pencil /> Modifier
                  </Button>
                </div>

                <TabsContent value="generated" className="mt-0">
                  <div
                    className="min-h-[400px] bg-card px-6 py-6 md:px-14 md:py-9"
                    data-testid="text-cv-output"
                  >
                    <FormattedCV text={displayText || "No text generated."} keywords={allKeywords} />
                  </div>
                </TabsContent>

                <TabsContent value="source" className="mt-0">
                  <div className="min-h-[300px] bg-card px-6 py-8 md:px-14 md:py-9" data-testid="section-source-bullets">
                    <p className="mb-6 border-b border-border/60 pb-4 text-xs italic text-muted-foreground">
                      Bullets originaux de ta bibliothèque, avant toute réécriture IA.
                    </p>
                    {report?.selectedExperiences?.map((exp: any, i: number) => {
                      const bullets = (report.selectedBullets || []).filter(
                        (b: any) => b.experienceTitle === exp.title,
                      );
                      return (
                        <div key={i} className="mb-6">
                          <div className="mb-2 flex items-center gap-3">
                            <p className={cn(DOC_EYEBROW, "min-w-0 truncate")}>{exp.title}</p>
                            <div className="h-px flex-1 bg-border/70" />
                            <p className="shrink-0 text-2xs text-muted-foreground">{exp.company}</p>
                          </div>
                          <div className="space-y-1.5">
                            {bullets.map((b: any, j: number) => (
                              <div key={j} className="flex items-start gap-2.5 pl-0.5">
                                <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
                                <p className={cn(CV_BODY, "text-foreground/90")}>{b.text}</p>
                              </div>
                            ))}
                            {bullets.length === 0 && (
                              <p className="pl-3 text-xs italic text-muted-foreground">Aucun bullet enregistré.</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {!report?.selectedExperiences?.length && (
                      <p className="text-sm italic text-muted-foreground">Aucune donnée source disponible.</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="job" className="mt-0">
                  <UsedJobPosting
                    meta={jobInput}
                    rawText={run?.jobPost?.rawText || undefined}
                    url={jobUrl || undefined}
                    parsedJob={parsedJob}
                  />
                </TabsContent>
              </Tabs>
            ) : (
              <div className={toolbarClass}>
                <span className="text-xs font-medium text-muted-foreground">Modification en cours</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelEdit}
                  data-testid="button-cancel-edit"
                >
                  <X /> Annuler
                </Button>
              </div>
            )}

            {isEditing && (
              <div className="bg-card p-4">
                <Textarea
                  data-testid="textarea-cv-edit"
                  value={editedText ?? ""}
                  onChange={e => setEditedText(e.target.value)}
                  className="min-h-[500px] resize-y rounded-md p-4 font-mono text-sm leading-relaxed"
                />
              </div>
            )}
          </Card>

          {/* ── RIGHT PANEL ── */}
          <div className="flex h-fit flex-col gap-3 lg:sticky lg:top-6" data-testid="section-report">

            {/* 1. Copy + Export */}
            <div className="flex gap-3">
              <Button
                onClick={handleCopy}
                className="flex-1"
                data-testid="button-copy-sticky"
              >
                {copied ? <Check /> : <Copy />}
                {copied ? "Copié !" : "Copier le CV"}
              </Button>
              <Button
                variant="outline"
                onClick={handleExportAnalysis}
                className="flex-1"
              >
                {exported ? <Check /> : <FileDown />}
                {exported ? "Prêt" : "Export IA"}
              </Button>
            </div>

            {/* 2. Fit / score card */}
            {displayScore != null && (
              <MatchDiagnosisCard
                score={displayScore}
                diagnosis={safeDiagnosis}
                fallbackUsed={report.fallbackUsed}
                scoreBreakdown={report.scoreBreakdown}
              />
            )}

            {/* 3. Keywords / Skills / Conseils */}
            <TabbedCoveragePanel
              covered={report?.postRules?.keywordsCovered || []}
              missing={report?.postRules?.keywordsMissing || []}
              injected={report?.postRules?.injectedKeywords || []}
              matchedSkills={report?.matchedSkills || []}
              missingSkills={report?.missingSkills || []}
              tips={report?.tips || []}
              insight={keyInsight || undefined}
            />

            {/* 4. Renforcer les experiences */}
            <EnrichmentCoaching
              report={report}
              selectedExperienceIds={run.selectedExperienceIds}
              jobTitle={report?.jobTitle}
            />

            {/* 5. Library health */}
            <LibraryHealthAccordion
              selectedBullets={report?.selectedBullets || []}
              selectedExperiences={report?.selectedExperiences || []}
              totalBullets={report?.postRules?.totalBullets ?? 0}
              bulletsWithNumbers={report?.postRules?.bulletsWithNumbers ?? 0}
            />

            {/* 6. Debug & metriques — internal only (dev build, or localStorage "dispatch:debug" = "1") */}
            {SHOW_DEBUG ? <DetailsDisclosure report={report || {}} scoreBreakdown={report?.scoreBreakdown} /> : null}

          </div>
        </div>

        {/* ── FOOTER ── */}
        <div
          className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3"
          data-testid="section-action-footer"
        >
          <Button
            variant="outline"
            onClick={handleTailorAgain}
            data-testid="button-tailor-again"
          >
            <WandSparkles /> Nouveau tailoring
          </Button>
          <Link href="/library">
            <Button
              variant="ghost"
              data-testid="button-improve-library"
            >
              <Library /> Améliorer la bibliothèque
            </Button>
          </Link>
        </div>

      </div>
    </Layout>
  );
}

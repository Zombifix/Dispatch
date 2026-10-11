import { useParams, Link, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { useRun } from "@/hooks/use-tailor";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
import { useToast } from "@/hooks/use-toast";
import { api } from "@shared/routes";

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

// ── Confidence Ring ──

function ConfidenceRing({ value, size = 72 }: { value: number; size?: number }) {
  const strokeWidth = 6;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, value)) / 100);
  const fitMeta = getFitLabel(value);

  return (
    <div className="flex flex-col items-center gap-1 flex-shrink-0" data-testid="section-confidence-ring">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" style={{ display: "block" }}>
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke="currentColor" strokeWidth={strokeWidth}
            className="text-muted/25"
          />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={fitMeta.ringColor} strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.8s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-base font-extrabold tabular-nums" data-testid="text-confidence-value">{value}%</span>
        </div>
      </div>
      <span className={`text-[11px] font-semibold tracking-tight ${fitMeta.textColor}`} data-testid="text-confidence-label">{fitMeta.label}</span>
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
      ? <mark key={i} className="bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 rounded-sm px-0.5 font-semibold not-italic">{part}</mark>
      : part
  );
}

// ── Formatted CV document renderer ──

const IS_FORMATION = /^(EDUCATION|FORMATION|FORMATION PROFESSIONNELLE)\s*$/i;
const IS_LANGUES   = /^(LANGUAGES?|LANGUES?)\s*$/i;

function renderCVLine(line: string, i: number, keywords: string[], isFirstContent: { val: boolean }): JSX.Element | null {
  if (line.startsWith("### ")) {
    const content = line.replace(/^###\s*/, "").replace(/\*\*/g, "");
    const parts = content.split("|").map(p => p.trim());
    const [roleRaw, company] = parts.length > 1 ? [parts[0], parts[1]] : [content, ""];
    return (
      <div key={i} className="mt-5 first:mt-0">
        <p className="text-[13px] font-bold text-foreground leading-snug">
          {roleRaw}
          {company && <span className="font-normal text-muted-foreground"> - {company}</span>}
        </p>
      </div>
    );
  }

  if (line.startsWith("## ")) {
    const heading = line.replace(/^##\s*/, "").replace(/\*\*/g, "").toUpperCase();
    return (
      <div key={i} className="mt-7 first:mt-0 flex items-center gap-3">
        <h2 className="text-[10px] font-extrabold text-muted-foreground tracking-[0.15em] uppercase whitespace-nowrap">{heading}</h2>
        <div className="flex-1 h-px bg-border/70" />
      </div>
    );
  }

  if (/^(skills?|competences?)[:\s]*/i.test(line) && !/^(?:[-*\u2022])\s+/.test(line)) {
    const rest = line.replace(/^(skills?|competences?)[:\s]*/i, "").trim();
    const sectionLabel = /^competences?/i.test(line) ? "Competences" : "Skills";
    return (
      <div key={i} className="mt-7">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-[10px] font-extrabold text-muted-foreground tracking-[0.15em] uppercase">{sectionLabel}</h2>
          <div className="flex-1 h-px bg-border/70" />
        </div>
        {rest && (
          <div className="flex flex-wrap gap-2">
            {rest.split(/[\u2022,|]/).map(s => s.trim()).filter(Boolean).map((skill, j) => (
              <span key={j} className="px-2.5 py-1 text-[11px] rounded-md bg-primary/8 border border-primary/20 text-primary font-medium">{repairMojibake(skill)}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (/^(PROFESSIONAL SUMMARY|RESUME PROFESSIONNEL|EXPERIENCE PROFESSIONNELLE?|EXPERIENCE|EDUCATION|FORMATION|LANGUAGES?|LANGUES?)\s*$/i.test(line)) {
    return (
      <div key={i} className="mt-7 first:mt-0 flex items-center gap-3">
        <h2 className="text-[10px] font-extrabold text-muted-foreground tracking-[0.15em] uppercase whitespace-nowrap">{line}</h2>
        <div className="flex-1 h-px bg-border/70" />
      </div>
    );
  }

  if (/^(?:[-*\u2022])\s+/.test(line)) {
    const bulletText = line.replace(/^(?:[-*\u2022])\s+/, "").replace(/\*\*/g, "");
    return (
      <div key={i} className="flex items-start gap-2.5 pl-0.5">
        <span className="mt-[7px] flex-shrink-0 w-1 h-1 rounded-full bg-foreground/40" />
        <p className="text-[13px] text-foreground/90 leading-relaxed">{highlightKeywords(bulletText, keywords)}</p>
      </div>
    );
  }

  if (/^\d{4}/.test(line) && (line.includes("-") || /present/i.test(line))) {
    return <p key={i} className="text-[11px] text-muted-foreground mt-0.5 mb-1">{line}</p>;
  }

  const content = line.replace(/\*\*/g, "").replace(/^#+\s*/, "");
  if (isFirstContent.val && i <= 3) {
    if (i === 0) {
      isFirstContent.val = false;
      return <h1 key={i} className="text-xl font-bold text-foreground tracking-tight mb-0.5">{content}</h1>;
    }
    return <p key={i} className="text-sm text-muted-foreground leading-relaxed">{content}</p>;
  }

  return <p key={i} className="text-[13px] text-foreground/85 leading-relaxed">{highlightKeywords(content, keywords)}</p>;
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
          return renderCVLine(t, formationStart + j + 10000, keywords, isFirstContent);
        }).filter(Boolean) as JSX.Element[];

        const lElems = lLines.map((l, j) => {
          const t = repairMojibake(l).trim();
          if (!t) return null;
          return renderCVLine(t, languesStart + j + 20000, keywords, isFirstContent);
        }).filter(Boolean) as JSX.Element[];

        elements.push(
          <div key="formation-langues-grid" className="mt-7 grid grid-cols-2 gap-x-8 items-start">
            <div className="space-y-1.5">{fElems}</div>
            <div className="space-y-1.5">{lElems}</div>
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

const MODE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  original: { label: "Fidele", icon: <ShieldCheck className="w-3 h-3" />, color: "bg-primary/10 text-primary" },
  polished: { label: "Optimise", icon: <Zap className="w-3 h-3" />, color: "bg-accent/10 text-accent" },
  adaptive: { label: "Adaptatif", icon: <RefreshCw className="w-3 h-3" />, color: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
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
  if (score >= 78) return { label: "Fit fort", textColor: "text-green-600 dark:text-green-400", ringColor: "#22c55e" };
  if (score >= 45) return { label: "Fit partiel", textColor: "text-amber-600 dark:text-amber-400", ringColor: "#f59e0b" };
  return { label: "Fit faible", textColor: "text-red-600 dark:text-red-400", ringColor: "#ef4444" };
}

function getBadgeMeta(badge?: BadgeLevel) {
  switch (badge) {
    case "probant":
      return { label: "Probant", className: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700" };
    case "a_renforcer":
      return { label: "A renforcer", className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700" };
    case "fragile":
      return { label: "Fragile", className: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-300 dark:border-red-700" };
    default:
      return { label: "n/a", className: "bg-muted text-muted-foreground border-border/60" };
  }
}

function getCredibilityMeta(credibility?: ReportScoreBreakdown["recruiterCredibility"]) {
  switch (credibility) {
    case "forte":
      return { label: "Credibilite forte", className: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700" };
    case "correcte":
      return { label: "Credibilite correcte", className: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700" };
    case "fragile":
      return { label: "Credibilite fragile", className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700" };
    case "faible":
      return { label: "Credibilite faible", className: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-300 dark:border-red-700" };
    default:
      return { label: "Credibilite n/a", className: "bg-muted text-muted-foreground border-border/60" };
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
        className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700",
      };
    case "lead_scope_underproven":
      return {
        label: "Scope lead peu prouve",
        description: "Le metier est proche, mais le leadership reel reste encore peu ancre dans tes preuves.",
        className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700",
      };
    case "pm_scope_underproven":
      return {
        label: "Scope PM / CRM peu prouve",
        description: "Le poste attend un vrai scope product management que le profil ne prouve pas assez.",
        className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700",
      };
    case "niche_domain_underproven":
      return {
        label: "Domaine niche partiellement prouve",
        description: "Le role reste plausible, mais les preuves tres specifiques du domaine sont encore limites.",
        className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700",
      };
    case "text_integrity_issue":
      return {
        label: "Texte corrompu",
        description: "Des artefacts d'encodage reduisent fortement la credibilite du document.",
        className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700",
      };
    default:
      return {
        label: code,
        description: "",
        className: "bg-muted text-muted-foreground border-border/60",
      };
  }
}

function getOptimizationDecisionMeta(decision?: ReportScoreBreakdown["optimizationDecision"]) {
  switch (decision) {
    case "faithful_only":
      return {
        label: "Version fidele servie",
        className: "bg-muted text-muted-foreground border-border/60",
      };
    case "optimized_selected":
      return {
        label: "Optimise humain retenu",
        className: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700",
      };
    case "optimized_rejected":
      return {
        label: "CV fidele (optimisation rejetee)",
        className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700",
      };
    default:
      return null;
  }
}

function computeLetterGrade(scoreBreakdown?: ReportScoreBreakdown, confidence?: number): { grade: string; label: string; className: string } | null {
  const score = scoreBreakdown?.pertinence ?? scoreBreakdown?.fitOffer ?? confidence;
  if (score == null) return null;
  const hasHardWarnings = (scoreBreakdown?.hardWarnings?.length ?? 0) > 0;
  const overstatement = scoreBreakdown?.overstatementRisk ?? 0;
  const fitNiveau = scoreBreakdown?.fitNiveau;
  const domain = scoreBreakdown?.distanceDomain;
  const levelMismatch = fitNiveau === "trop_junior" || fitNiveau === "trop_senior";

  if (hasHardWarnings || overstatement > 80) {
    return { grade: "F", label: "Hors zone", className: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-300 dark:border-red-700" };
  }
  if (score >= 80 && !levelMismatch && domain !== "different") {
    return { grade: "A", label: "Excellent", className: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700" };
  }
  if (score >= 60 && !levelMismatch) {
    return { grade: "B", label: "Bon fit", className: "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700" };
  }
  if (score >= 40 || domain === "adjacent") {
    return { grade: "C", label: "Partiel", className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700" };
  }
  if (score >= 20) {
    return { grade: "D", label: "Faible", className: "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700" };
  }
  return { grade: "F", label: "Hors zone", className: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-300 dark:border-red-700" };
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
  const size = 56;
  const strokeWidth = 5;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const displayScore = scoreBreakdown?.pertinence ?? scoreBreakdown?.fitOffer ?? confidence;
  const offset = circumference * (1 - Math.max(0, Math.min(100, displayScore)) / 100);
  const fitMeta = getFitLabel(displayScore);
  const color = fitMeta.ringColor;

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
    <Card className="border-border/60 shadow-none" data-testid="section-match-score">
      <CardContent className="p-4">
        {/* Domain mismatch warning — prominent, above the ring */}
        {(scoreBreakdown?.domainMismatch || scoreBreakdown?.distanceDomain === "different") && (
          <div className="flex items-start gap-2 mb-3 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug font-medium">
              Mismatch detecte ({scoreBreakdown.domainMismatch || "distance metier"}) : les competences se croisent partiellement mais le coeur du role differe.
            </p>
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90" style={{ display: "block" }}>
              <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-muted/25" />
              <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
                strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
                style={{ transition: "stroke-dashoffset 0.8s ease" }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-extrabold tabular-nums" data-testid="text-match-score-value">{displayScore}%</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`text-sm font-bold ${fitMeta.textColor}`} data-testid="text-match-score-label">{fitMeta.label}</p>
              {letterGrade && (
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${letterGrade.className}`} title={letterGrade.label}>
                  {letterGrade.grade}
                </span>
              )}
              {scoreBreakdown?.badge && (
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badgeMeta.className}`}>
                  {badgeMeta.label}
                </span>
              )}
            </div>
            {fallbackUsed && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium mt-0.5">Match faible : bullets de substitution utilises</p>
            )}
            {(distanceLabel || fitNiveauLabel) && (
              <p className="text-[10px] text-muted-foreground mt-1">
                {[distanceLabel, fitNiveauLabel].filter(Boolean).join(" • ")}
              </p>
            )}
          </div>
        </div>

        {/* Score breakdown — ATS vs semantic */}
        {/* V3 breakdown: Fit metier + ancrage preuves + credibilite + risque */}
        {scoreBreakdown?.fitMetier != null && (
          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border/50 sm:grid-cols-4">
            <div className="space-y-1">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Fit metier</p>
              <div className="flex items-center gap-1.5">
                <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${scoreBreakdown!.fitMetier! >= 60 ? "bg-green-500" : scoreBreakdown!.fitMetier! >= 30 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${scoreBreakdown!.fitMetier}%` }} />
                </div>
                <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{scoreBreakdown!.fitMetier}%</span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Ancrage preuves</p>
              <div className="flex items-center gap-1.5">
                <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${evidenceGrounding! >= 60 ? "bg-green-500" : evidenceGrounding! >= 30 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${evidenceGrounding}%` }} />
                </div>
                <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{evidenceGrounding}%</span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Credibilite</p>
              <div className="flex items-center gap-1.5">
                <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${recruiterCredibilityScore! >= 60 ? "bg-green-500" : recruiterCredibilityScore! >= 30 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${recruiterCredibilityScore}%` }} />
                </div>
                <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{recruiterCredibilityScore}%</span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Risque survente</p>
              <div className="flex items-center gap-1.5">
                <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${overstatementRisk! <= 35 ? "bg-green-500" : overstatementRisk! < 60 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${overstatementRisk}%` }} />
                </div>
                <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{overstatementRisk}%</span>
              </div>
            </div>
          </div>
        )}
        {/* Legacy breakdown: ATS + semantic (when v3 not available) */}
        {scoreBreakdown && scoreBreakdown.fitMetier == null && (
          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border/50">
            <div className="space-y-1">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Keywords prouves</p>
              <div className="flex items-center gap-1.5">
                <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${scoreBreakdown.ats >= 70 ? "bg-green-500" : scoreBreakdown.ats >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${scoreBreakdown.ats}%` }} />
                </div>
                <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{scoreBreakdown.ats}%</span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Bullets semantiques</p>
              <div className="flex items-center gap-1.5">
                <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${scoreBreakdown.semantic >= 70 ? "bg-green-500" : scoreBreakdown.semantic >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${scoreBreakdown.semantic}%` }} />
                </div>
                <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{scoreBreakdown.semantic}%</span>
              </div>
            </div>
          </div>
        )}
        {scoreBreakdown && optimizedAts !== undefined && optimizedAts > scoreBreakdown.ats && (
          <p className="text-[10px] text-muted-foreground leading-relaxed mt-2">
            ATS final du CV : <span className="font-semibold text-foreground">{optimizedAts}%</span>
            {atsBoost ? ` (+${atsBoost}% via optimisation)` : ""}
            {overstatementRisk != null ? ", a lire apres la credibilite et l'ancrage preuves." : ""}
          </p>
        )}

        {insightSentence && !scoreBreakdown && (
          <p className="text-[11px] text-muted-foreground leading-relaxed mt-3 pt-3 border-t border-border/50 italic" data-testid="text-match-score-insight">
            {insightSentence}.
          </p>
        )}
      </CardContent>
    </Card>
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
        <h4 className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Skills de l'offre</h4>
        <span className="text-xs font-bold text-primary tabular-nums">{matched.length}/{total}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {matched.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-1.5">
            {visibleMatched.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium" data-testid={`badge-matched-${i}`}>
                <CheckCircle className="w-3 h-3 flex-shrink-0" /> {repairMojibake(s)}
              </span>
            ))}
            {!showAllMatched && matched.length > MATCHED_CAP && (
              <button onClick={() => setShowAllMatched(true)} className="px-2 py-0.5 text-xs rounded-full border border-border/60 text-muted-foreground hover:text-foreground transition-colors">
                +{matched.length - MATCHED_CAP}
              </button>
            )}
          </div>
        </div>
      )}
      {missing.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">
            {matched.length === 0 ? "Absentes — cliquer pour ajouter" : "Manquantes — cliquer pour ajouter"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {visibleMissing.map((s, i) => {
              const isAdded = added.has(s);
              return (
                <button
                  key={i}
                  data-testid={`badge-missing-${i}`}
                  onClick={() => handleAdd(s)}
                  disabled={isAdded || mutation.isPending}
                  title={isAdded ? "Ajoute a la bibliotheque" : "Ajouter a la bibliotheque"}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full font-medium border transition-all ${
                    isAdded
                      ? "bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 cursor-default"
                      : "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 cursor-pointer"
                  }`}
                >
                  {isAdded ? <Check className="w-3 h-3 flex-shrink-0" /> : <Plus className="w-3 h-3 flex-shrink-0" />}
                  {repairMojibake(s)}
                </button>
              );
            })}
            {!showAllMissing && missing.length > MISSING_CAP && (
              <button onClick={() => setShowAllMissing(true)} className="px-2 py-0.5 text-xs rounded-full border border-border/60 text-muted-foreground hover:text-foreground transition-colors">
                +{missing.length - MISSING_CAP}
              </button>
            )}
          </div>
        </div>
      )}
      {total === 0 && <p className="text-xs text-muted-foreground italic">Aucune donnee de competence disponible.</p>}
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
        <p className="text-xs text-foreground/70 leading-relaxed italic border-l-2 border-yellow-400/50 pl-2" data-testid="text-insight">
          {repairMojibake(insight)}
        </p>
      )}
      {tips && tips.length > 0 && (
        <>
          <ul className="space-y-1.5">
            {visibleTips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-foreground/80 leading-relaxed" data-testid={`text-tip-${i}`}>
                <Lightbulb className="w-3.5 h-3.5 mt-0.5 text-yellow-500 flex-shrink-0" />
                {repairMojibake(tip)}
              </li>
            ))}
          </ul>
          {tips.length > TIPS_CAP && (
            <button onClick={() => setShowAll(v => !v)} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              {showAll ? "Reduire" : `Voir les ${tips.length - TIPS_CAP} autres conseils`}
            </button>
          )}
        </>
      )}
    </div>
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
  const barColor = score >= 70 ? "bg-green-500" : score >= 40 ? "bg-amber-400" : "bg-red-500";

  return (
    <div className="rounded-[12px] border border-[rgba(225,231,239,0.6)] bg-white" data-testid="section-library-health">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-2"><Library className="w-3.5 h-3.5" /> Bibliothèque — {score}%</span>
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div className="border-t border-[rgba(225,231,239,0.6)] px-4 py-3 space-y-3 bg-[rgba(241,245,249,0.25)] rounded-b-[12px]">
          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${score}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-[11px] text-muted-foreground">Bullets chiffrées : <span className="font-medium text-foreground">{pctWithNumbers}%</span></span>
            <span className="text-[11px] text-muted-foreground">Keywords matchés : <span className="font-medium text-foreground">{pctWithTags}%</span></span>
            <span className="text-[11px] text-muted-foreground">Expériences avec contexte : <span className="font-medium text-foreground">{expWithDescription}/{selectedExperiences.length}</span></span>
          </div>
        </div>
      )}
    </div>
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
    <div className="rounded-[12px] border border-[rgba(225,231,239,0.6)] bg-white" data-testid="section-details">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        data-testid="button-toggle-details"
      >
        <span className="flex items-center gap-2"><BookOpen className="w-3.5 h-3.5" /> Debug &amp; métriques</span>
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="border-t border-[rgba(225,231,239,0.6)] px-4 py-4 space-y-4 bg-[rgba(241,245,249,0.25)] rounded-b-[12px]">
          {scoreBreakdown && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Detail du score</p>
              {scoreBreakdown?.fitMetier != null ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium">Pertinence</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${displayScore >= 70 ? "bg-green-500" : displayScore >= 40 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${displayScore}%` }} />
                      </div>
                      <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{displayScore}%</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">Repere de triage base sur le document genere, le bon metier, la preuve source et la credibilite du CV.</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium">Fit metier</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${scoreBreakdown!.fitMetier! >= 60 ? "bg-green-500" : scoreBreakdown!.fitMetier! >= 30 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${scoreBreakdown!.fitMetier}%` }} />
                      </div>
                      <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{scoreBreakdown!.fitMetier}%</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">Juge la proximite du metier a partir du CV genere et des bullets sources retenus, pas du titre seul.</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium">Ancrage preuves</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${evidenceGrounding! >= 60 ? "bg-green-500" : evidenceGrounding! >= 30 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${evidenceGrounding}%` }} />
                      </div>
                      <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{evidenceGrounding}%</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">Mesure a quel point le document final reste bien ancre dans les preuves concretes de ton parcours.</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium">Credibilite recruteur</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${recruiterCredibilityScore! >= 60 ? "bg-green-500" : recruiterCredibilityScore! >= 30 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${recruiterCredibilityScore}%` }} />
                      </div>
                      <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{recruiterCredibilityScore}%</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">Estime si un recruteur humain croira le document final, au-dela de l'ATS et du vernis lexical.</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium">Risque de survente</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${overstatementRisk! <= 35 ? "bg-green-500" : overstatementRisk! < 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${overstatementRisk}%` }} />
                      </div>
                      <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{overstatementRisk}%</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">Frein de securite si la reformulation ou l'ATS poussent le document au-dela de ce que le profil prouve vraiment.</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium">Badge document</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {letterGrade && (
                        <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-bold ${letterGrade.className}`} title={letterGrade.label}>
                          {letterGrade.grade} — {letterGrade.label}
                        </span>
                      )}
                      <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold ${badgeMeta.className}`}>
                        {badgeMeta.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">Resume si le CV genere parait probant, a renforcer ou fragile.</p>
                  </div>
                  {(distanceLabel || fitNiveauLabel) && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground font-medium">Lecture rapide</p>
                      <div className="flex flex-wrap gap-1.5">
                        {distanceLabel && (
                          <span className="inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold bg-muted/40 text-foreground">
                            {distanceLabel}
                          </span>
                        )}
                        {fitNiveauLabel && (
                          <span className="inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold bg-muted/40 text-foreground">
                            {fitNiveauLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">Ces libelles resument la distance metier et la coherence de niveau du document final.</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium">Fit offre</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${displayScore >= 70 ? "bg-green-500" : displayScore >= 40 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${displayScore}%` }} />
                      </div>
                      <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{displayScore}%</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">Mesure ce que ta bibliotheque prouve vraiment pour cette offre, avant le vernis ATS.</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium">ATS prouve</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${scoreBreakdown.ats >= 70 ? "bg-green-500" : scoreBreakdown.ats >= 40 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${scoreBreakdown.ats}%` }} />
                      </div>
                      <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{scoreBreakdown.ats}%</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium">Bullets semantiques</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${scoreBreakdown.semantic >= 70 ? "bg-green-500" : scoreBreakdown.semantic >= 40 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${scoreBreakdown.semantic}%` }} />
                      </div>
                      <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{scoreBreakdown.semantic}%</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">Mesure a quel point les bullets retenus racontent quelque chose de proche du role, meme sans reprendre mot pour mot l'annonce.</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium">Credibilite recruteur</p>
                    <div>
                      <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold ${credibilityMeta.className}`}>
                        {credibilityMeta.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">Estime si un humain croirait a la promesse du CV final, au-dela des seuls mots-cles.</p>
                  </div>
                </div>
              )}
              {scoreBreakdown.atsOptimized !== undefined && (
                <p className="text-[10px] text-muted-foreground leading-relaxed mt-2">
                  ATS final du document : <span className="font-semibold text-foreground">{scoreBreakdown.atsOptimized}%</span>
                  {scoreBreakdown.atsBoost ? `, dont ${scoreBreakdown.atsBoost}% vient d'optimisations de texte.` : "."}
                  {" "}Cet axe reste secondaire face a la credibilite et a l'ancrage preuves.
                </p>
              )}
              {scoreBreakdown.contextSupport !== undefined && scoreBreakdown.contextSupport > 0 && (
                <p className="text-[10px] text-muted-foreground leading-relaxed mt-1">
                  Contexte mission : <span className="font-semibold text-foreground">{scoreBreakdown.contextSupport}%</span> de support secondaire detecte.
                </p>
              )}
            </div>
          )}

          {/* Detected Keywords */}
          {report.detectedKeywords && (
            <div>
              <button
                onClick={() => setShowKeywords(v => !v)}
                className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground mb-1.5"
                data-testid="button-toggle-keywords"
              >
                <Hash className="w-3 h-3" />
                Mots-cles detectes
                {showKeywords ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
              </button>
              {showKeywords && (
                <div className="space-y-2">
                  {[
                    { label: "Competences requises", items: report.detectedKeywords.requiredSkills, cls: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" },
                    { label: "Competences souhaitees", items: report.detectedKeywords.preferredSkills, cls: "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400" },
                    { label: "Responsabilites", items: report.detectedKeywords.responsibilities, cls: "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400" },
                    { label: "Domaine", items: report.detectedKeywords.keywords, cls: "bg-muted text-muted-foreground" },
                  ].filter(g => g.items?.length).map(g => (
                    <div key={g.label}>
                      <p className="text-[9px] uppercase tracking-wide text-muted-foreground/70 mb-1">{g.label}</p>
                      <div className="flex flex-wrap gap-1">
                        {g.items.map((k: string, i: number) => (
                          <span key={i} className={`px-1.5 py-px text-[10px] rounded font-medium ${g.cls}`}>
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
      )}
    </div>
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
    <div className="rounded-[12px] border border-[rgba(225,231,239,0.6)] bg-white" data-testid="section-enrichment-coaching">
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <h3 className="text-xs font-bold text-blue-700 dark:text-blue-300 tracking-wide uppercase">Renforcer tes experiences</h3>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Ton profil colle, mais ces elements manquent dans tes bullets. Enrichis directement l'experience concernee.
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
                <div className="p-3 rounded-lg border border-border/60 bg-background hover:border-blue-400/50 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 transition-all cursor-pointer group">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-[12px] font-semibold text-foreground truncate">{card.title} — {card.company}</p>
                    <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity shrink-0">Enrichir &rarr;</span>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {card.missingKeywords.map((kw: string, i: number) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100/60 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 font-medium">{kw}</span>
                    ))}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
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
    <Card className="border-border/60 shadow-none border-amber-200/60 dark:border-amber-800/40 bg-amber-50/40 dark:bg-amber-950/20" data-testid="section-library-suggestions">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <h3 className="text-xs font-bold text-amber-700 dark:text-amber-300 tracking-wide uppercase">Ameliorer la bibliotheque</h3>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
          Ces competences manquent dans votre Super-CV. Ajoutez-les en 1 clic pour ameliorer vos prochains tailorings.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {missingSkills.slice(0, 12).map(skill => {
            const isAdded = added.has(skill);
            return (
              <button
                key={skill}
                data-testid={`button-add-skill-${skill}`}
                onClick={() => { if (!isAdded && !mutation.isPending) mutation.mutate(skill); }}
                disabled={isAdded || mutation.isPending}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border transition-all ${
                  isAdded
                    ? "bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 cursor-default"
                    : "bg-background border-border/60 text-foreground hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 cursor-pointer"
                }`}
              >
                {isAdded
                  ? <Check className="w-3 h-3" />
                  : <Plus className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                }
                {repairMojibake(skill)}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
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
  const scoreColor = pct >= 70 ? "text-green-600 dark:text-green-400" : pct >= 40 ? "text-amber-600 dark:text-amber-400" : "text-red-500 dark:text-red-400";
  const barColor = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  const visibleCovered = showAllCovered ? covered : covered.slice(0, COVERED_CAP);
  const visibleMissing = showAllMissing ? missing : missing.slice(0, MISSING_CAP);

  return (
    <div className="space-y-3" data-testid="section-critical-keywords">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">Keywords critiques</h4>
        <span className={`text-xs font-bold tabular-nums ${scoreColor}`}>{covered.length}/{total} dans le CV</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visibleCovered.map((k, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">
            <Check className="w-2.5 h-2.5 flex-shrink-0" /> {k}
          </span>
        ))}
        {!showAllCovered && covered.length > COVERED_CAP && (
          <button onClick={() => setShowAllCovered(true)} className="px-2 py-0.5 text-[11px] rounded-full border border-border/60 text-muted-foreground hover:text-foreground transition-colors">
            +{covered.length - COVERED_CAP}
          </button>
        )}
        {visibleMissing.map((k, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 font-medium">
            <X className="w-2.5 h-2.5 flex-shrink-0" /> {k}
          </span>
        ))}
        {!showAllMissing && missing.length > MISSING_CAP && (
          <button onClick={() => setShowAllMissing(true)} className="px-2 py-0.5 text-[11px] rounded-full border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 hover:opacity-80 transition-colors">
            +{missing.length - MISSING_CAP} manquants
          </button>
        )}
      </div>
      {injected && injected.length > 0 && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Injectes pour ATS : {injected.join(", ")}.
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
      return { label: "Scrape fiable", className: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" };
    case "uncertain":
      return { label: "Scrape a verifier", className: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" };
    case "bad":
      return { label: "Scrape faible", className: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" };
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

  return (
    <div className="rounded-[12px] border border-[rgba(225,231,239,0.6)] bg-white" data-testid="section-match-diagnosis">
      <div className="p-4 space-y-[12px]">
        {/* Score hero */}
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-1.5">
            <ConfidenceRing value={displayScore} size={56} />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{scoreLabel}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`text-sm font-bold ${fitMeta.textColor}`}>{fitMeta.label}</p>
              {letterGrade && (
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${letterGrade.className}`} title={letterGrade.label}>
                  {letterGrade.grade}
                </span>
              )}
              {scoreBreakdown?.badge ? (
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badgeMeta.className}`}>
                  {badgeMeta.label}
                </span>
              ) : scoreBreakdown?.recruiterCredibility ? (
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${credibilityMeta.className}`}>
                  {credibilityMeta.label}
                </span>
              ) : null}
            </div>
            {primaryDiagnosis && (
              <p className="text-[11px] text-foreground font-medium mt-0.5">{primaryDiagnosis}</p>
            )}
          </div>
        </div>

        {/* Verdict */}
        <p className="text-[12px] text-foreground/80 leading-relaxed">{verdict}</p>

        {/* Consolidated warning — single line */}
        {warning && (
          <div className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border text-[11px] font-medium leading-snug ${
            warning.severity === "error"
              ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-300"
              : warning.severity === "warn"
              ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-300"
              : "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/40 text-blue-700 dark:text-blue-300"
          }`}>
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            {warning.message}
          </div>
        )}

        {/* Progressive disclosure toggle */}
        {hasDetail && (
          <button
            onClick={() => setShowDetail(v => !v)}
            className="w-full flex items-center justify-between text-[11px] text-muted-foreground hover:text-foreground transition-colors pt-1"
          >
            <span>{showDetail ? "Masquer l'analyse" : "Voir l'analyse"}</span>
            {showDetail ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}

        {/* Detail panel */}
        {showDetail && (
          <div className="space-y-3 pt-1 border-t border-border/40">
            {optimizationNotes.length > 0 && (
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Decision moteur</p>
                {optimizationNotes.slice(0, 2).map((note, i) => (
                  <p key={i} className="text-[11px] text-foreground/80 leading-relaxed">{note}</p>
                ))}
              </div>
            )}

            {primaryCause && (
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Cause principale</p>
                <p className="text-[12px] font-medium text-foreground">{primaryCause}</p>
                {secondaryCauses.length > 0 && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">Causes secondaires : {secondaryCauses.join(", ")}.</p>
                )}
                {recommendedAction && (
                  <p className="text-[11px] text-foreground/80 leading-relaxed">Action recommandee : {recommendedAction}</p>
                )}
              </div>
            )}

            {whatMatches.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Ce qui matche</p>
                <ul className="space-y-1.5">
                  {whatMatches.slice(0, 4).map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12px] text-foreground/80 leading-relaxed">
                      <CheckCircle className="w-3.5 h-3.5 mt-0.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                  {whatMatches.length > 4 && (
                    <li className="text-[11px] text-muted-foreground pl-5">+{whatMatches.length - 4} autre{whatMatches.length - 4 > 1 ? "s" : ""}</li>
                  )}
                </ul>
              </div>
            )}

            {whatMissing.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Ce qui manque</p>
                <ul className="space-y-1.5">
                  {whatMissing.slice(0, 4).map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12px] text-foreground/80 leading-relaxed">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                  {whatMissing.length > 4 && (
                    <li className="text-[11px] text-muted-foreground pl-5">+{whatMissing.length - 4} autre{whatMissing.length - 4 > 1 ? "s" : ""}</li>
                  )}
                </ul>
              </div>
            )}

            {nextActions.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Quoi faire maintenant</p>
                <ul className="space-y-1.5">
                  {nextActions.slice(0, 3).map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12px] text-foreground/80 leading-relaxed">
                      <Lightbulb className="w-3.5 h-3.5 mt-0.5 text-yellow-500 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                  {nextActions.length > 3 && (
                    <li className="text-[11px] text-muted-foreground pl-5">+{nextActions.length - 3} autre{nextActions.length - 3 > 1 ? "s" : ""}</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
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

  return (
    <div className="bg-white dark:bg-zinc-950 px-8 py-10 md:px-14 md:py-12 min-h-[300px]" data-testid="section-used-job-posting">
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
          <Globe className="w-3 h-3" /> {sourceBadge(meta)}
        </span>
        {qualityMeta && (
          <span className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full font-semibold ${qualityMeta.className}`}>
            {qualityMeta.label}
          </span>
        )}
        {meta?.scrapeStatus && (
          <span className="text-[11px] text-muted-foreground">{repairMojibake(meta.scrapeMessage || "")}</span>
        )}
      </div>

      {(meta?.normalizedUrl || url) && (
        <div className="mb-4">
          <p className="text-[10px] font-extrabold text-muted-foreground tracking-[0.12em] uppercase mb-2">Source</p>
          <a
            href={meta?.normalizedUrl || url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline break-all"
          >
            <ExternalLink className="w-3 h-3" /> {meta?.normalizedUrl || url}
          </a>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <p className="text-[10px] font-extrabold text-muted-foreground tracking-[0.12em] uppercase">Annonce utilisee</p>
          {hasParsed ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRaw(v => !v)}
              className="h-7 px-2.5 text-[11px]"
              data-testid="button-toggle-job-posting-raw"
            >
              {showRaw ? "Voir la synthèse" : "Voir le texte brut"}
            </Button>
          ) : wasCleaned ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRaw(v => !v)}
              className="h-7 px-2.5 text-[11px]"
              data-testid="button-toggle-job-posting-raw"
            >
              {showRaw ? "Voir nettoyee" : "Voir brut"}
            </Button>
          ) : null}
        </div>

        {/* Parsed structured view */}
        {hasParsed && !showRaw ? (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold text-foreground leading-snug">
                {parsedJob!.title}
                {parsedJob!.company && (
                  <span className="text-muted-foreground font-normal"> — {parsedJob!.company}</span>
                )}
              </h3>
              <div className="flex gap-1.5 flex-wrap mt-2">
                {parsedJob!.seniority && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium capitalize">
                    {parsedJob!.seniority}
                  </span>
                )}
                {parsedJob!.positioning && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                    {POSITIONING_DISPLAY[parsedJob!.positioning] || parsedJob!.positioning}
                  </span>
                )}
                {parsedJob!.domain && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                    {parsedJob!.domain}
                  </span>
                )}
                {parsedJob!.language && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                    {parsedJob!.language}
                  </span>
                )}
              </div>
            </div>

            {parsedJob!.responsibilities.length > 0 && (
              <div>
                <p className="text-[10px] font-extrabold text-muted-foreground tracking-[0.12em] uppercase mb-2">Missions</p>
                <ul className="space-y-1.5">
                  {parsedJob!.responsibilities.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground/85">
                      <span className="mt-2 w-1 h-1 rounded-full bg-primary/50 flex-shrink-0" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {mergedRequirements.length > 0 && (
              <div>
                <p className="text-[10px] font-extrabold text-muted-foreground tracking-[0.12em] uppercase mb-2">
                  Exigences de l'offre
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {mergedRequirements.map((item, index) => {
                    const isCritical = (parsedJob!.criticalKeywords || []).includes(item);
                    return (
                      <span
                        key={`${item}-${index}`}
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${isCritical ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                      >
                        {item}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {parsedJob!.intentions.length > 0 && (
              <div>
                <p className="text-[10px] font-extrabold text-muted-foreground tracking-[0.12em] uppercase mb-2">
                  Ce que le poste cherche vraiment
                </p>
                <ul className="space-y-1">
                  {parsedJob!.intentions.map((intent, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground/70 italic">
                      <span className="mt-2 w-1 h-1 rounded-full bg-muted-foreground/40 flex-shrink-0" />
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
              <p className="text-[11px] text-muted-foreground mb-3">
                Texte nettoye pour la lecture.
              </p>
            )}
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/85 font-sans">
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
  { value: "waiting",   label: "En attente", activeClass: "bg-muted text-foreground border-border" },
  { value: "interview", label: "Entretien",  activeClass: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700" },
  { value: "rejected",  label: "Refus",      activeClass: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-300 dark:border-red-700" },
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

  return (
    <div className="space-y-3" data-testid="section-application-tracker">
      {!tracking.applied ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Tu as postule avec ce CV ?</p>
          <Button size="sm" variant="outline" className="w-full gap-2 text-xs" onClick={() => save({ applied: true, appliedAt: today })}>
            <Check className="w-3.5 h-3.5" /> J'ai postule
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/40">
            <span className="text-xs font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
              <Check className="w-3 h-3" /> Postule
            </span>
            <input
              type="date"
              value={tracking.appliedAt}
              onChange={e => save({ appliedAt: e.target.value })}
              className="text-xs border-b border-dashed border-muted-foreground/30 bg-transparent outline-none text-muted-foreground cursor-pointer"
            />
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Reponse recue</p>
            <div className="grid grid-cols-3 gap-1">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => save({ status: opt.value })}
                  className={`text-[11px] px-1 py-1.5 rounded-md border transition-all font-medium ${
                    tracking.status === opt.value ? opt.activeClass : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {(tracking.status === "interview" || tracking.status === "rejected") && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Date reponse
              </span>
              <input
                type="date"
                value={tracking.responseAt}
                onChange={e => save({ responseAt: e.target.value })}
                className="text-xs border-b border-dashed border-muted-foreground/30 bg-transparent outline-none text-muted-foreground cursor-pointer"
              />
            </div>
          )}

          <button
            onClick={() => save(TRACKING_DEFAULT)}
            className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors block mt-1"
          >
            Reinitialiser
          </button>
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
    <div className="rounded-[12px] border border-[rgba(225,231,239,0.6)] bg-white overflow-hidden" data-testid="section-coverage-panel">
      <Tabs defaultValue={hasKeywords ? "keywords" : hasSkills ? "skills" : "conseils"}>
        <TabsList className="w-full rounded-none rounded-t-[12px] border-b border-[rgba(225,231,239,0.6)] bg-[rgba(241,245,249,0.3)] h-[28px] gap-0 p-0">
          {hasKeywords && <TabsTrigger value="keywords" className="text-[12px] font-medium h-[28px] px-3 flex-1 rounded-none data-[state=active]:rounded-t-[3px]">Mots-clés</TabsTrigger>}
          {hasSkills && <TabsTrigger value="skills" className="text-[12px] font-medium h-[28px] px-3 flex-1 rounded-none data-[state=active]:rounded-t-[3px]">Skills</TabsTrigger>}
          {hasTips && <TabsTrigger value="conseils" className="text-[12px] font-medium h-[28px] px-3 flex-1 rounded-none data-[state=active]:rounded-t-[3px]">Conseils</TabsTrigger>}
        </TabsList>
        {hasKeywords && (
          <TabsContent value="keywords" className="p-4 mt-0">
            <CriticalKeywordsCoverage covered={covered} missing={missing} injected={injected} />
          </TabsContent>
        )}
        {hasSkills && (
          <TabsContent value="skills" className="p-4 mt-0">
            <SkillsCoverage matched={matchedSkills} missing={missingSkills} />
          </TabsContent>
        )}
        {hasTips && (
          <TabsContent value="conseils" className="p-4 mt-0">
            <KeyTips tips={tips} insight={insight} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

type CvRewriteView = { target: "summary" | "bullet"; original: string; rewritten: string; reason: string; reverted?: boolean };

// Retouches faites par l'IA : visibles, motivées, réversibles une par une.
function RewritesPanel({ runId, rewrites }: { runId: string; rewrites: CvRewriteView[] }) {
  const { toast } = useToast();
  const revert = useMutation({
    mutationFn: (index: number) => apiRequest("POST", `/api/runs/${runId}/rewrites/${index}/revert`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.tailor.getRun.path, runId] });
      toast({ title: "Formulation d'origine rétablie" });
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });
  if (!rewrites.length) {
    return (
      <div className="border-t border-[rgba(225,231,239,0.6)] px-6 py-4 text-[12px] text-[#64748b]" data-testid="section-rewrites-empty">
        Aucune phrase n'a été retouchée par l'IA : ce CV est composé uniquement de tes formulations.
      </div>
    );
  }
  return (
    <div className="border-t border-[rgba(225,231,239,0.6)] px-6 py-5 space-y-3" data-testid="section-rewrites">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#64748b]">
        Retouches IA ({rewrites.filter(r => !r.reverted).length}/{rewrites.length} actives)
      </p>
      {rewrites.map((rw, i) => (
        <div key={i} className={`rounded-lg border p-3 text-[13px] ${rw.reverted ? "opacity-60 border-[#e2e8f0]" : "border-[#c7d2fe] bg-[#f8faff]"}`}>
          <p className="text-[11px] text-[#64748b] mb-1">{rw.target === "summary" ? "Résumé" : "Bullet"} · {rw.reason}</p>
          <p className="text-[#94a3b8] line-through decoration-[#cbd5e1]">{rw.original || "(vide)"}</p>
          <p className="text-[#0f1729] mt-1">{rw.rewritten}</p>
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={rw.reverted || revert.isPending}
              onClick={() => revert.mutate(i)}
              data-testid={`button-revert-rewrite-${i}`}
            >
              {rw.reverted ? "Formulation d'origine conservée" : "Revenir à ma formulation"}
            </Button>
          </div>
        </div>
      ))}
    </div>
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
  const { toast } = useToast();

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

  const saveEdit = useMutation({
    mutationFn: (text: string) => apiRequest("PATCH", `/api/runs/${id}/cv`, { text }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [api.tailor.getRun.path, id] });
      setEditedText(null);
      setIsEditing(false);
      toast({ title: "CV enregistré" });
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

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
          <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          <h2 className="text-xl font-semibold text-muted-foreground animate-pulse" data-testid="text-loading">Generation du CV en cours...</h2>
        </div>
      </Layout>
    );
  }

  if (error || !run) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center max-w-md mx-auto gap-4">
          <AlertCircle className="w-12 h-12 text-destructive" />
          <h2 className="text-2xl font-bold" data-testid="text-error-title">Resultat introuvable</h2>
          <p className="text-muted-foreground" data-testid="text-error-message">Ce CV a peut-etre ete supprime ou une erreur s'est produite.</p>
          <Link href="/tailor"><Button data-testid="button-try-again">Reessayer</Button></Link>
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

  return (
    <Layout>
      <div className="flex flex-col gap-5 animate-in fade-in duration-400">

        {/* ── PAGE HEADER ── */}
        <div className="flex items-start justify-between gap-4" data-testid="section-page-header">
          {/* Gauche : back + score + titre */}
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <Link href="/history">
              <button
                className="flex-shrink-0 w-9 h-9 rounded-[12px] border border-[#0f1729] bg-white flex items-center justify-center hover:bg-[#f8fafc] transition-colors shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
                data-testid="button-back"
              >
                <ArrowLeft className="w-4 h-4 text-[#64748b]" />
              </button>
            </Link>

            {displayScore != null && (
              <div className="flex-shrink-0 flex flex-col items-center gap-0.5">
                <ConfidenceRing value={displayScore} size={68} />
                <span className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[#65758b]">
                  Pertinence
                </span>
              </div>
            )}

            <div className="flex-1 min-w-0">
              <h1
                className="text-xl font-extrabold tracking-tight text-[#1e293b] leading-tight"
                data-testid="text-page-title"
              >
                {pageTitle}
              </h1>
              {safeDiagnosis?.primaryDiagnosis && (
                <p className="text-[13px] text-amber-600 leading-snug mt-0.5">
                  {repairMojibake(safeDiagnosis.primaryDiagnosis)}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span
                  className={"inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full font-semibold " + modeMeta.color}
                  data-testid="badge-mode"
                >
                  {modeMeta.icon} {modeMeta.label}
                </span>
                {report?.detectedLanguage && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold"
                    data-testid="badge-language"
                  >
                    <Globe className="w-3 h-3" /> {repairMojibake(report.detectedLanguage)}
                  </span>
                )}
                {report?.jobSeniority && (
                  <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#f1f5f9] text-[#64748b] font-medium">
                    {repairMojibake(report.jobSeniority)}
                  </span>
                )}
                {jobUrl && (
                  <a
                    href={jobUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full border border-[#e2e8f0] bg-white text-[#64748b] hover:text-[#1e293b] transition-colors font-medium"
                    data-testid="link-job-posting"
                  >
                    <ExternalLink className="w-3 h-3" /> Voir l'annonce
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Droite : Suivi de candidature — aligné avec le titre, largeur = col sidebar */}
          <div className="hidden xl:flex flex-shrink-0 w-[384px] rounded-[12px] border border-[rgba(225,231,239,0.7)] bg-[rgba(241,245,249,0.25)] p-4 items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[#0f1729] mb-0.5">Suivi de candidature</p>
              <ApplicationTrackerSafe
                runId={run.id}
                initialTracking={(run as any).tracking as AppTracking | null}
              />
            </div>
            <img
              src="/suivi-illustration.png"
              alt=""
              className="flex-shrink-0 h-[80px] w-auto object-contain pointer-events-none"
            />
          </div>
        </div>

        {/* ── MAIN GRID ── */}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_384px] gap-[28px] items-start">

          {/* CENTER: CV Document */}
          <div
            className="flex flex-col rounded-[12px] overflow-hidden border border-[rgba(225,231,239,0.6)] bg-white"
            data-testid="section-cv-panel"
          >
            <div className="flex items-center justify-between border-b border-[rgba(225,231,239,0.6)] bg-[rgba(255,255,255,0.7)] px-4 py-2 gap-3">
              {!isEditing ? (
                <Tabs defaultValue="generated" className="flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <TabsList className="h-7 text-xs bg-white/80 rounded-lg">
                      <TabsTrigger value="generated" className="text-xs h-6 px-2.5 rounded-md" data-testid="tab-generated">CV genere</TabsTrigger>
                      <TabsTrigger value="source" className="text-xs h-6 px-2.5 rounded-md" data-testid="tab-source">Super CV utilise</TabsTrigger>
                      <TabsTrigger value="job" className="text-xs h-6 px-2.5 rounded-md" data-testid="tab-job">Annonce utilisee</TabsTrigger>
                    </TabsList>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleStartEdit}
                      className="text-xs h-7 px-2.5 text-[#94a3b8] hover:text-[#1e293b] gap-1.5"
                      data-testid="button-edit-cv"
                    >
                      <Pencil className="w-3 h-3" /> Modifier
                    </Button>
                  </div>

                  <TabsContent value="generated" className="mt-0">
                    <div
                      className="bg-white px-6 py-6 md:px-10 md:py-7 min-h-[400px]"
                      data-testid="text-cv-output"
                    >
                      <FormattedCV text={displayText || "No text generated."} keywords={allKeywords} />
                    </div>
                  </TabsContent>

                  <TabsContent value="source" className="mt-0">
                    <div className="bg-white px-8 py-10 md:px-14 md:py-12 min-h-[300px]" data-testid="section-source-bullets">
                      <p className="text-xs text-[#94a3b8] italic mb-6 pb-4 border-b border-[#f1f5f9]">
                        Bullets originaux de ta bibliotheque, avant toute reecriture IA.
                      </p>
                      {report?.selectedExperiences?.map((exp: any, i: number) => {
                        const bullets = (report.selectedBullets || []).filter(
                          (b: any) => b.experienceTitle === exp.title,
                        );
                        return (
                          <div key={i} className="mb-6">
                            <div className="flex items-center gap-3 mb-2">
                              <p className="text-[10px] font-extrabold text-[#94a3b8] tracking-[0.12em] uppercase">{exp.title}</p>
                              <div className="flex-1 h-px bg-[#f1f5f9]" />
                              <p className="text-[10px] text-[#94a3b8]">{exp.company}</p>
                            </div>
                            <div className="space-y-1.5">
                              {bullets.map((b: any, j: number) => (
                                <div key={j} className="flex items-start gap-2.5">
                                  <span className="mt-[7px] flex-shrink-0 w-1 h-1 rounded-full bg-[#1e293b]/40" />
                                  <p className="text-[13px] leading-relaxed">{b.text}</p>
                                </div>
                              ))}
                              {bullets.length === 0 && (
                                <p className="text-xs text-[#94a3b8] italic pl-3">Aucun bullet enregistre.</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {!report?.selectedExperiences?.length && (
                        <p className="text-sm text-[#94a3b8] italic">Aucune donnee source disponible.</p>
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
                <div className="flex items-center justify-between w-full gap-3">
                  <span className="text-xs text-[#94a3b8] font-medium">Modification en cours</span>
                  <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => editedText != null && saveEdit.mutate(editedText)}
                    disabled={saveEdit.isPending || !editedText?.trim()}
                    className="text-xs h-7 px-3"
                    data-testid="button-save-edit"
                  >
                    {saveEdit.isPending ? "Enregistrement..." : "Enregistrer"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelEdit}
                    className="text-xs h-7 px-2.5 text-[#94a3b8] hover:text-[#1e293b] gap-1.5"
                    data-testid="button-cancel-edit"
                  >
                    <X className="w-3 h-3" /> Annuler
                  </Button>
                  </div>
                </div>
              )}
            </div>

            {isEditing && (
              <div className="bg-white p-4">
                <Textarea
                  data-testid="textarea-cv-edit"
                  value={editedText ?? ""}
                  onChange={e => setEditedText(e.target.value)}
                  className="w-full min-h-[500px] resize-y font-mono text-sm leading-relaxed border border-[#e2e8f0] rounded-xl p-4"
                />
              </div>
            )}

            {!isEditing && run && (
              <RewritesPanel runId={run.id} rewrites={((report as any)?.rewrites || []) as CvRewriteView[]} />
            )}
          </div>

          {/* ── RIGHT PANEL ── */}
          <div className="flex flex-col gap-[20px] h-fit xl:sticky xl:top-6" data-testid="section-report">

            {/* Suivi — mobile uniquement (desktop = header) */}
            <div className="xl:hidden rounded-[12px] border border-[rgba(225,231,239,0.7)] bg-[rgba(241,245,249,0.25)] p-4 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[#0f1729] mb-0.5">Suivi de candidature</p>
                <ApplicationTrackerSafe
                  runId={run.id}
                  initialTracking={(run as any).tracking as AppTracking | null}
                />
              </div>
              <img
                src="/suivi-illustration.png"
                alt=""
                className="flex-shrink-0 h-[80px] w-auto object-contain pointer-events-none"
              />
            </div>

            {/* 1. Copy + Export — groupés, gap interne serré */}
            <div className="grid grid-cols-2 gap-[8px]">
              <Button
                variant="default"
                onClick={handleCopy}
                className="rounded-[12px] gap-[8px] text-[14px] font-medium h-9 min-h-[36px] bg-[#2563eb] hover:bg-[#1d4ed8] text-[#f8fafc] shadow-[0px_1px_2px_0px_rgba(100,103,242,0.2)]"
                data-testid="button-copy-sticky"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copie !" : "Copier le CV"}
              </Button>
              <Button
                variant="default"
                onClick={handleExportAnalysis}
                className="rounded-[12px] gap-[8px] text-[14px] font-medium h-9 min-h-[36px] bg-[#2563eb] hover:bg-[#1d4ed8] text-[#f8fafc] shadow-[0px_1px_2px_0px_rgba(100,103,242,0.2)]"
              >
                {exported ? <Check className="w-3.5 h-3.5" /> : <FileDown className="w-3.5 h-3.5" />}
                {exported ? "Pret" : "Export IA"}
              </Button>
            </div>

            {/* 3. Fit / score card */}
            {displayScore != null && (
              <MatchDiagnosisCard
                score={displayScore}
                diagnosis={safeDiagnosis}
                fallbackUsed={report.fallbackUsed}
                scoreBreakdown={report.scoreBreakdown}
              />
            )}

            {/* 4. Keywords / Skills / Conseils */}
            <TabbedCoveragePanel
              covered={report?.postRules?.keywordsCovered || []}
              missing={report?.postRules?.keywordsMissing || []}
              injected={report?.postRules?.injectedKeywords || []}
              matchedSkills={report?.matchedSkills || []}
              missingSkills={report?.missingSkills || []}
              tips={report?.tips || []}
              insight={keyInsight || undefined}
            />

            {/* 5. Renforcer les experiences */}
            <EnrichmentCoaching
              report={report}
              selectedExperienceIds={run.selectedExperienceIds}
              jobTitle={report?.jobTitle}
            />

            {/* 6. Library health */}
            <LibraryHealthAccordion
              selectedBullets={report?.selectedBullets || []}
              selectedExperiences={report?.selectedExperiences || []}
              totalBullets={report?.postRules?.totalBullets ?? 0}
              bulletsWithNumbers={report?.postRules?.bulletsWithNumbers ?? 0}
            />

            {/* 7. Debug & metriques */}
            <DetailsDisclosure report={report || {}} scoreBreakdown={report?.scoreBreakdown} />

          </div>
        </div>

        {/* ── FOOTER ── */}
        <div
          className="flex items-center gap-2 pt-3 border-t border-[#f1f5f9] flex-wrap"
          data-testid="section-action-footer"
        >
          <Button
            variant="outline"
            onClick={handleTailorAgain}
            className="rounded-xl gap-2 text-sm"
            data-testid="button-tailor-again"
          >
            <WandSparkles className="w-4 h-4" /> Nouveau tailoring
          </Button>
          <Link href="/library">
            <Button
              variant="ghost"
              className="rounded-xl gap-2 text-sm text-[#94a3b8] hover:text-[#1e293b]"
              data-testid="button-improve-library"
            >
              <Library className="w-4 h-4" /> Ameliorer la bibliotheque
            </Button>
          </Link>
        </div>

      </div>
    </Layout>
  );
}

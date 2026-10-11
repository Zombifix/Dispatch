import { useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { useRuns } from "@/hooks/use-tailor";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";

function getTracking(run: any) {
  if (run.tracking && typeof run.tracking === "object") return run.tracking;
  try {
    return JSON.parse(localStorage.getItem(`app-tracking-${run.id}`) || "null");
  } catch {
    return null;
  }
}

function getTrackingMeta(run: any) {
  const tracking = getTracking(run);
  if (!tracking?.applied) return null;
  if (tracking.status === "interview") {
    return {
      label: "Entretien",
      className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
      icon: <Check className="h-3 w-3" />,
    };
  }
  if (tracking.status === "rejected") {
    return {
      label: "Refus",
      className: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400",
      icon: <X className="h-3 w-3" />,
    };
  }
  return {
    label: "Postule",
    className: "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
    icon: <Send className="h-3 w-3" />,
  };
}

const MODE_META = {
  original: {
    label: "Fidele",
    icon: <ShieldCheck className="h-3 w-3" />,
    className: "bg-[rgba(31,179,199,0.1)] text-[#1fb3c7]",
  },
  polished: {
    label: "Optimise",
    icon: <Zap className="h-3 w-3" />,
    className: "bg-[rgba(31,179,199,0.1)] text-[#1fb3c7]",
  },
  adaptive: {
    label: "Adaptatif",
    icon: <RefreshCw className="h-3 w-3" />,
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
} as const;

function getScoreTone(value: number) {
  if (value >= 70) return "bg-green-500";
  if (value >= 40) return "bg-amber-500";
  return "bg-red-500";
}

function getBadgeMeta(badge?: string) {
  if (badge === "probant") {
    return { label: "Probant", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" };
  }
  if (badge === "a_renforcer") {
    return { label: "A renforcer", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" };
  }
  if (badge === "fragile") {
    return { label: "Fragile", className: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400" };
  }
  return null;
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    const day = d.getDate();
    const month = d.toLocaleString("fr-FR", { month: "short" }).toUpperCase();
    const year = d.getFullYear();
    const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `${day} ${month}. ${year}, ${time}`;
  } catch {
    return iso;
  }
}

const PAGE_SIZE = 10;

function RunCard({ run, index }: { run: any; index: number }) {
  const report = run.outputReportJson as any;
  const modeMeta = MODE_META[run.mode as keyof typeof MODE_META] || MODE_META.polished;
  const trackingMeta = getTrackingMeta(run);
  const displayScore = report?.scoreBreakdown?.pertinence ?? report?.confidence;
  const badgeMeta = getBadgeMeta(report?.scoreBreakdown?.badge);
  const atsOptimized = report?.scoreBreakdown?.atsOptimized;
  const selectedExperiences = report?.selectedExperiences?.length ?? 0;
  const detectedLang = report?.detectedLanguage ? report.detectedLanguage.toUpperCase() : "";

  const shortVerdict =
    report?.diagnosis?.primaryDiagnosis ||
    report?.confidenceReasoning ||
    "Ouvre le resultat pour revoir le detail.";

  return (
    <Link href={`/results/${run.id}`}>
      <article
        className="group cursor-pointer rounded-[28px] border border-[rgba(225,231,239,0.7)] bg-[rgba(255,255,255,0.75)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg hover:shadow-primary/5"
        data-testid={`card-history-${index}`}
      >
        <div className="p-6 flex flex-col gap-3">
          {/* Main row: left content + right score card */}
          <div className="flex items-start justify-between gap-4">
            {/* Left: date, title, company, badges, verdict */}
            <div className="flex flex-col gap-3 min-w-0 flex-1">
              {/* Date + lang */}
              <div className="text-[11px] font-normal uppercase tracking-[1.98px] text-muted-foreground">
                {formatDate(run.createdAt)}{detectedLang ? ` ${detectedLang}` : ""}
              </div>

              {/* Title + company */}
              <div className="space-y-0.5">
                <h3
                  className="text-[20px] font-semibold leading-tight tracking-[-0.5px] text-foreground transition-colors group-hover:text-primary"
                  data-testid={`text-history-title-${index}`}
                >
                  {report?.jobTitle || "Poste inconnu"}
                </h3>
                {report?.jobCompany && (
                  <p className="text-sm text-muted-foreground">{report.jobCompany}</p>
                )}
              </div>

              {/* Badges */}
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${modeMeta.className}`}>
                  {modeMeta.icon}
                  {modeMeta.label}
                </span>
                {badgeMeta && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${badgeMeta.className}`}>
                    <Sparkles className="h-3 w-3" />
                    {badgeMeta.label}
                  </span>
                )}
                {trackingMeta && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${trackingMeta.className}`}>
                    {trackingMeta.icon}
                    {trackingMeta.label}
                  </span>
                )}
                {selectedExperiences > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-medium text-[#65758b]">
                    <FileText className="h-3 w-3" />
                    {selectedExperiences} experiences
                  </span>
                )}
              </div>

              {/* Verdict */}
              <p className="text-sm leading-6 text-muted-foreground line-clamp-2">{shortVerdict}</p>
            </div>

            {/* Score card */}
            <div className="flex-shrink-0 flex flex-col gap-3 bg-[rgba(255,255,255,0.8)] border border-[rgba(225,231,239,0.6)] rounded-[24px] p-[17px] min-w-[176px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[1.98px] text-muted-foreground">
                  Pertinence
                </span>
                <span className="text-[20px] font-bold tabular-nums text-foreground">
                  {displayScore != null ? `${displayScore}%` : "n/a"}
                </span>
              </div>
              {displayScore != null && (
                <div className="h-2 overflow-hidden rounded-full bg-[#f1f5f9]">
                  <div
                    className={`h-full rounded-full ${getScoreTone(displayScore)}`}
                    style={{ width: `${Math.max(0, Math.min(100, displayScore))}%` }}
                  />
                </div>
              )}
              <div className="flex gap-3 text-xs">
                <div className="flex flex-col gap-1">
                  <p className="text-muted-foreground">ATS</p>
                  <p className="font-semibold text-foreground">
                    {typeof atsOptimized === "number" ? `${atsOptimized}%` : "n/a"}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-muted-foreground">Document</p>
                  <p className="font-semibold text-foreground">{badgeMeta?.label || "—"}</p>
                </div>
              </div>
            </div>
          </div>

          {/* CTA - right aligned */}
          <div className="flex items-center justify-end gap-1.5 text-sm font-medium text-[#2d4cd5]">
            Voir le CV adapté
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>
      </article>
    </Link>
  );
}

export default function History() {
  const { data: runs, isLoading, error } = useRuns();
  const [page, setPage] = useState(0);

  const runsWithScore =
    runs?.filter((run: any) => {
      const report = run.outputReportJson as any;
      return typeof (report?.scoreBreakdown?.pertinence ?? report?.confidence) === "number";
    }) ?? [];

  const averageScore =
    runsWithScore.length > 0
      ? Math.round(
          runsWithScore.reduce((sum: number, run: any) => {
            const report = run.outputReportJson as any;
            return sum + (report?.scoreBreakdown?.pertinence ?? report?.confidence ?? 0);
          }, 0) / runsWithScore.length,
        )
      : null;

  const appliedCount = runs?.filter((run: any) => getTracking(run)?.applied).length ?? 0;
  const interviewCount = runs?.filter((run: any) => getTracking(run)?.status === "interview").length ?? 0;

  const totalPages = runs ? Math.ceil(runs.length / PAGE_SIZE) : 0;
  const pagedRuns = runs ? runs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : [];

  return (
    <Layout pageLabel="Historique">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 animate-in fade-in duration-500">
        {/* Page header */}
        <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-background/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <Clock className="h-3.5 w-3.5 text-primary" />
              Historique
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-foreground">
              Derniers CV générés
            </h1>
            <p className="text-xl text-muted-foreground">
              Retrouve l'historique de tes CV générés et suis tes candidatures.
            </p>
          </div>

          <Link href="/tailor">
            <Button className="h-11 rounded-2xl px-5 text-sm shadow-lg shadow-primary/20 flex-shrink-0">
              <WandSparkles className="mr-2 h-4 w-4" />
              Nouveau tailoring
            </Button>
          </Link>
        </section>

        {/* Stats */}
        {!isLoading && !error && runs && runs.length > 0 && (
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[24px] border border-[rgba(225,231,239,0.7)] bg-[rgba(255,255,255,0.75)] px-[21px] pt-5 pb-9 shadow-sm flex flex-col gap-1">
              <p className="text-sm font-semibold uppercase tracking-[2.2px] text-muted-foreground">Runs</p>
              <p className="pt-1 text-3xl font-bold text-foreground">{runs.length}</p>
              <p className="text-sm text-muted-foreground">CV générés et disponibles dans l'historique.</p>
            </div>

            <div className="rounded-[24px] border border-[rgba(225,231,239,0.7)] bg-[rgba(255,255,255,0.75)] px-[21px] pt-5 pb-9 shadow-sm flex flex-col gap-1">
              <p className="text-sm font-semibold uppercase tracking-[2.2px] text-muted-foreground">CV envoyés</p>
              <p className="pt-1 text-3xl font-bold text-foreground">{appliedCount}</p>
              <p className="text-sm text-muted-foreground">CV envoyés à des offres.</p>
            </div>

            <div className="rounded-[24px] border border-[rgba(225,231,239,0.7)] bg-[rgba(255,255,255,0.75)] px-[21px] pt-5 pb-9 shadow-sm flex flex-col gap-1">
              <p className="text-sm font-semibold uppercase tracking-[2.2px] text-muted-foreground">Entretiens obtenus</p>
              <p className="pt-1 text-3xl font-bold text-foreground">{interviewCount}</p>
              <p className="text-sm text-muted-foreground">Candidatures ayant donné lieu à un entretien.</p>
            </div>

            <div className="rounded-[24px] border border-[rgba(225,231,239,0.7)] bg-[rgba(255,255,255,0.75)] px-[21px] pt-5 pb-9 shadow-sm flex flex-col gap-1">
              <p className="text-sm font-semibold uppercase tracking-[2.2px] text-muted-foreground">Adéquation moyenne</p>
              <p className="pt-1 text-3xl font-bold text-foreground">
                {averageScore != null ? `${averageScore}%` : "n/a"}
              </p>
              <p className="text-sm text-muted-foreground">Avec les offres</p>
            </div>
          </section>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="grid gap-3 sm:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-48 rounded-[20px] bg-muted/40 animate-pulse" />
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 rounded-[20px] border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            Impossible de charger l'historique.
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && runs?.length === 0 && (
          <Card className="border-2 border-dashed bg-transparent shadow-none">
            <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <div className="rounded-2xl bg-muted/50 p-4">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-foreground">Aucun CV généré</p>
                <p className="text-sm text-muted-foreground">Ton historique apparaîtra ici après ton premier tailoring.</p>
              </div>
              <Link href="/tailor">
                <Button variant="outline" className="mt-2 rounded-2xl" data-testid="button-start-tailoring">
                  <WandSparkles className="mr-2 h-4 w-4" />
                  Lancer un tailoring
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Run list */}
        {!isLoading && runs && runs.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-foreground">Runs recents</h2>

            <div className="grid gap-4 sm:grid-cols-2">
              {pagedRuns.map((run: any, i: number) => (
                <RunCard key={run.id} run={run} index={i} />
              ))}
            </div>

            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl h-9 px-4"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Précédent
              </Button>
              <span className="rounded-full border border-border/70 bg-background px-4 py-1.5 text-sm text-muted-foreground tabular-nums">
                {page + 1} / {totalPages || 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl h-9 px-4"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                Suivant
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </section>
        )}
      </div>
    </Layout>
  );
}

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { useRuns } from "@/hooks/use-tailor";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { PageHeader, StatGroup } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mascot } from "@/components/brand/mascot";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { cn } from "@/lib/utils";
import { SCORE_THRESHOLDS, SCORE_TONE_BG, scoreTone } from "@/lib/score";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  FileText,
  Search,
  Send,
  Users,
  WandSparkles,
  X,
} from "lucide-react";

function getTracking(run: any) {
  if (run.tracking && typeof run.tracking === "object") return run.tracking;
  try {
    return JSON.parse(localStorage.getItem(`app-tracking-${run.id}`) || "null");
  } catch {
    return null;
  }
}

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

function getTrackingMeta(run: any): { label: string; variant: BadgeVariant } | null {
  const tracking = getTracking(run);
  if (!tracking?.applied) return null;
  if (tracking.status === "interview") return { label: "Entretien", variant: "success" };
  if (tracking.status === "rejected") return { label: "Refus", variant: "destructive" };
  return { label: "Postulé", variant: "primary" };
}

const MODE_LABEL: Record<string, string> = {
  original: "CV fidèle",
  polished: "CV optimisé",
  adaptive: "CV adaptatif",
};

function getBadgeMeta(badge?: string): { label: string; variant: BadgeVariant } | null {
  if (badge === "probant") return { label: "Probant", variant: "success" };
  if (badge === "a_renforcer") return { label: "À renforcer", variant: "warning" };
  if (badge === "fragile") return { label: "Fragile", variant: "destructive" };
  return null;
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
    const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `${date}, ${time}`;
  } catch {
    return iso;
  }
}

const getScore = (run: any): number | null => {
  const report = run.outputReportJson as any;
  const value = report?.scoreBreakdown?.pertinence ?? report?.confidence;
  return typeof value === "number" ? value : null;
};

const PAGE_SIZE = 10;

type RunFilter = "all" | "applied" | "interview";
type RunSort = "recent" | "oldest" | "score";

function Metric({ label, value, barClassName }: { label: string; value: number | null; barClassName: string }) {
  return (
    <div className="flex min-w-[112px] flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-xl font-bold leading-6 tabular-nums text-foreground">{value != null ? `${value}%` : "n/a"}</span>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        {value != null ? (
          <span className={cn("block h-full rounded-full", barClassName)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        ) : null}
      </span>
    </div>
  );
}

/** Application row (DA v2): identity · Pertinence · ATS · status · action. */
function RunRow({ run, index }: { run: any; index: number }) {
  const report = run.outputReportJson as any;
  const trackingMeta = getTrackingMeta(run);
  const score = getScore(run);
  const badgeMeta = getBadgeMeta(report?.scoreBreakdown?.badge);
  const ats = typeof report?.scoreBreakdown?.atsOptimized === "number" ? report.scoreBreakdown.atsOptimized : null;
  const company: string = report?.jobCompany || "";
  const verdict: string =
    report?.diagnosis?.primaryDiagnosis || report?.confidenceReasoning || "Ouvre le résultat pour revoir le détail.";
  const isWeak = score != null && score < SCORE_THRESHOLDS.partial;

  return (
    <Card
      className="grid grid-cols-1 items-center gap-5 p-5 transition-[border-color,box-shadow] hover:border-primary/25 lg:grid-cols-[minmax(0,1.5fr)_auto_minmax(0,1.2fr)_auto] lg:gap-6 lg:px-6"
      data-testid={`card-history-${index}`}
    >
      {/* Identity */}
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-sm text-muted-foreground">{formatDate(run.createdAt)}</span>
        <div className="flex min-w-0 items-center gap-4">
          <CompanyAvatar name={company || report?.jobTitle} logoUrl={run.jobPost?.extractedJson?.companyLogoUrl} />
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold leading-6 tracking-[-0.02em] text-foreground" data-testid={`text-history-title-${index}`}>
              {report?.jobTitle || "Poste inconnu"}
            </h3>
            {company ? <p className="truncate text-base text-muted-foreground">{company}</p> : null}
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="size-4" />
              {MODE_LABEL[run.mode as string] ?? "CV adapté"}
              {badgeMeta ? <Badge variant={badgeMeta.variant}>{badgeMeta.label}</Badge> : null}
            </p>
          </div>
        </div>
      </div>

      {/* Scores */}
      <div className="flex gap-6 lg:border-l lg:border-border/60 lg:pl-6">
        <Metric label="Pertinence" value={score} barClassName={score != null ? SCORE_TONE_BG[scoreTone(score)] : ""} />
        <div className="border-l border-border/60 pl-6">
          <Metric label="Score ATS" value={ats} barClassName="bg-primary" />
        </div>
      </div>

      {/* Status */}
      <div className="flex min-w-0 flex-col items-start gap-2 lg:border-l lg:border-border/60 lg:pl-6">
        {trackingMeta ? (
          <Badge variant={trackingMeta.variant} className="px-3 py-1 text-sm">
            <span className={cn("size-2 rounded-full", trackingMeta.variant === "success" ? "bg-success" : trackingMeta.variant === "destructive" ? "bg-destructive" : "bg-primary")} />
            {trackingMeta.label}
          </Badge>
        ) : null}
        {isWeak && !trackingMeta ? (
          <p className="flex items-start gap-2.5 rounded-lg bg-destructive-soft px-3.5 py-2.5 text-sm leading-5 text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span className="line-clamp-2">{verdict}</span>
          </p>
        ) : (
          <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">{verdict}</p>
        )}
      </div>

      {/* Action */}
      <Button asChild variant="soft" className="justify-self-start lg:justify-self-end">
        <Link href={`/results/${run.id}`}>
          Voir l’analyse
          <ArrowRight />
        </Link>
      </Button>
    </Card>
  );
}

/**
 * Runs created before logo lookup existed have no `companyLogoUrl` yet: resolve them once,
 * one request at a time, then refresh the list. The server stores the answer (even "none").
 */
function useCompanyLogoBackfill(runs: any[] | undefined) {
  const queryClient = useQueryClient();
  const requested = useRef(new Set<string>());

  useEffect(() => {
    const pending = (runs ?? []).filter((run) => {
      const extracted = run.jobPost?.extractedJson;
      return run.jobPost?.url && !(extracted && "companyLogoUrl" in extracted) && !requested.current.has(run.id);
    });
    if (pending.length === 0) return;

    let cancelled = false;
    (async () => {
      let resolvedAny = false;
      for (const run of pending.slice(0, 10)) {
        if (cancelled) return;
        requested.current.add(run.id);
        try {
          const res = await fetch(`/api/runs/${run.id}/company-logo`, { method: "POST", credentials: "include" });
          if (res.ok) resolvedAny = true;
        } catch {
          // offline / server error: the initial stays, we'll retry on the next visit
        }
      }
      if (resolvedAny && !cancelled) queryClient.invalidateQueries({ queryKey: ["/api/runs"] });
    })();

    return () => {
      cancelled = true;
    };
  }, [runs, queryClient]);
}

export default function History() {
  const { data: runs, isLoading, error } = useRuns();
  useCompanyLogoBackfill(runs);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<RunFilter>("all");
  const [sort, setSort] = useState<RunSort>("recent");
  const [query, setQuery] = useState("");

  const scores = (runs ?? []).map(getScore).filter((value): value is number => value != null);
  const averageScore = scores.length > 0 ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null;
  const appliedCount = runs?.filter((run: any) => getTracking(run)?.applied).length ?? 0;
  const interviewCount = runs?.filter((run: any) => getTracking(run)?.status === "interview").length ?? 0;

  const normalizedQuery = query.trim().toLowerCase();
  const filteredRuns = (runs ?? [])
    .filter((run: any) => {
      const tracking = getTracking(run);
      if (filter === "applied" && !tracking?.applied) return false;
      if (filter === "interview" && tracking?.status !== "interview") return false;
      if (!normalizedQuery) return true;
      const report = run.outputReportJson as any;
      return `${report?.jobTitle ?? ""} ${report?.jobCompany ?? ""}`.toLowerCase().includes(normalizedQuery);
    })
    .sort((a: any, b: any) => {
      if (sort === "score") return (getScore(b) ?? -1) - (getScore(a) ?? -1);
      const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return sort === "oldest" ? -diff : diff;
    });

  const totalPages = Math.ceil(filteredRuns.length / PAGE_SIZE);
  const pagedRuns = filteredRuns.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleFilter = (next: RunFilter) => {
    setFilter((current) => (current === next ? "all" : next));
    setPage(0);
  };

  const hasRuns = !isLoading && !error && runs && runs.length > 0;

  return (
    <Layout>
      <div className="flex flex-col gap-7 animate-in fade-in duration-500">
        <PageHeader
          eyebrow="Historique"
          title="Candidatures récentes"
          description="Retrouve l’historique de tes CV générés et suis tes candidatures."
          actions={
            <Button asChild size="lg">
              <Link href="/tailor">
                <WandSparkles />
                Nouveau tailoring
                <ArrowRight />
              </Link>
            </Button>
          }
        />

        {hasRuns ? (
          <StatGroup
            items={[
              { icon: <FileText />, value: runs.length, label: "Candidatures", hint: "CV générés et disponibles dans l’historique." },
              { icon: <Send />, value: appliedCount, label: "CV envoyés", hint: "CV envoyés à des offres.", onClick: () => toggleFilter("applied"), active: filter === "applied" },
              { icon: <Users />, value: interviewCount, label: "Entretiens", hint: "Candidatures ayant donné lieu à un entretien.", onClick: () => toggleFilter("interview"), active: filter === "interview" },
              { icon: <BarChart3 />, value: averageScore != null ? `${averageScore}%` : "n/a", label: "Adéquation moyenne", hint: "Avec les offres ciblées." },
            ]}
          />
        ) : null}

        {isLoading ? (
          <div className="flex flex-col gap-4">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-32 animate-pulse rounded-2xl bg-card/70" />
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive-soft p-4 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            Impossible de charger l’historique.
          </div>
        ) : null}

        {!isLoading && !error && runs?.length === 0 ? (
          <Card variant="panel" className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
            <Mascot variant="thinking" className="size-32" />
            <div className="flex flex-col gap-1">
              <p className="text-xl font-semibold text-foreground">Aucune candidature pour l’instant</p>
              <p className="text-base text-muted-foreground">Ton historique apparaîtra ici après ton premier tailoring.</p>
            </div>
            <Button asChild className="mt-2" data-testid="button-start-tailoring">
              <Link href="/tailor">
                <WandSparkles />
                Lancer un tailoring
              </Link>
            </Button>
          </Card>
        ) : null}

        {hasRuns ? (
          <section className="flex flex-col gap-4" aria-label="Candidatures">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-[480px]">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                  placeholder="Rechercher un poste, une entreprise…"
                  className="h-12 pl-12 shadow-card"
                  aria-label="Rechercher dans l’historique"
                />
              </div>
              <div className="flex items-center gap-2">
                {filter !== "all" ? (
                  <Button variant="ghost" onClick={() => toggleFilter(filter)}>
                    <X />
                    {filter === "applied" ? "CV envoyés" : "Entretiens"}
                  </Button>
                ) : null}
                <Select value={sort} onValueChange={(value) => setSort(value as RunSort)}>
                  <SelectTrigger className="h-12 w-[200px] gap-2 rounded-xl bg-card px-4 text-base shadow-card" aria-label="Trier">
                    <ArrowUpDown className="size-4 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent">Plus récent</SelectItem>
                    <SelectItem value="oldest">Plus ancien</SelectItem>
                    <SelectItem value="score">Meilleure pertinence</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {filteredRuns.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
                Aucune candidature ne correspond à ces critères.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {pagedRuns.map((run: any, i: number) => (
                  <RunRow key={run.id} run={run} index={i} />
                ))}
              </div>
            )}

            <div className="flex flex-col items-center justify-between gap-3 pt-1 sm:flex-row">
              <p className="text-sm text-muted-foreground">
                {filteredRuns.length} candidature{filteredRuns.length > 1 ? "s" : ""} affichée{filteredRuns.length > 1 ? "s" : ""}
              </p>
              {totalPages > 1 ? (
                <nav aria-label="Pagination" className="flex items-center gap-3">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                    <ChevronLeft />
                    Précédent
                  </Button>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {page + 1} / {totalPages}
                  </span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>
                    Suivant
                    <ChevronRight />
                  </Button>
                </nav>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </Layout>
  );
}

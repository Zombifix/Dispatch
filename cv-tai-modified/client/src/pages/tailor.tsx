import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { useGenerateTailor, useCheckMatch } from "@/hooks/use-tailor";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Eyebrow, PageHeader } from "@/components/ui/page-header";
import { Mascot } from "@/components/brand/mascot";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  FileText,
  Info,
  Link2,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Target,
  WandSparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SCRAPE_BLOCKED_DOMAINS = [
  "indeed.com",
  "glassdoor.com",
  "monster.com",
  "apec.fr",
  "francetravail.fr",
  "pole-emploi.fr",
  "hellowork.com",
  "cadremploi.fr",
];

const TAILOR_PREFS_KEY = "cv-tailor:preferences";

type Mode = "fidele" | "optimise";
type InputMode = "lien" | "texte";
type PrecheckVerdict = "go" | "prudence" | "faible_chance";

type PendingConfirm = {
  score: number;
  jobTitle: string;
  verdict?: PrecheckVerdict;
  message?: string;
};

function getUrlWarning(url: string): string | null {
  if (!url) return null;

  try {
    const hostname = new URL(url).hostname.toLowerCase();

    if (SCRAPE_BLOCKED_DOMAINS.some((domain) => hostname.includes(domain))) {
      return "Ce site bloque le scraping automatique. Copie-colle le texte de l'annonce directement dans le champ ci-dessous.";
    }

    if (hostname.includes("linkedin.com")) {
      return "LinkedIn peut bloquer la récupération automatique. Si l'analyse échoue, colle le texte de l'annonce pour continuer.";
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeLinkedInUrl(rawUrl: string): { url: string; converted: boolean } {
  if (!rawUrl) return { url: rawUrl, converted: false };

  try {
    const urlObj = new URL(rawUrl);
    if (!urlObj.hostname.includes("linkedin.com")) return { url: rawUrl, converted: false };

    const jobIdParam = urlObj.searchParams.get("currentJobId");
    if (jobIdParam) {
      return { url: `https://www.linkedin.com/jobs/view/${jobIdParam}`, converted: true };
    }

    return { url: rawUrl, converted: false };
  } catch {
    return { url: rawUrl, converted: false };
  }
}

function getPrecheckVerdictMeta(verdict?: PrecheckVerdict) {
  switch (verdict) {
    case "go":
      return {
        label: "Go",
        emphasisClassName: "text-success-strong",
        description: "Le triage rapide voit assez de signaux pour lancer la génération sereinement.",
      };
    case "prudence":
      return {
        label: "Prudence",
        emphasisClassName: "text-warning",
        description: "Le triage rapide reste ouvert, mais l'annonce demande une lecture plus fine ou une source plus propre.",
      };
    case "faible_chance":
      return {
        label: "Faible chance",
        emphasisClassName: "text-destructive",
        description: "Le triage rapide voit peu de preuves directes pour cette offre à ce stade.",
      };
    default:
      return {
        label: "Pre-check",
        emphasisClassName: "text-muted-foreground",
        description: "Le triage rapide reste un signal indicatif avant la génération complète.",
      };
  }
}

/** Link vs pasted text: two exclusive modes, so a segmented control rather than an on/off switch. */
function InputModeSwitch({ value, onChange }: { value: InputMode; onChange: (value: InputMode) => void }) {
  return (
    <Segmented
      aria-label="Source de l'annonce"
      className="h-10 w-[200px] [&_button]:text-sm"
      value={value}
      onChange={onChange}
      options={[
        { value: "lien", label: "Lien" },
        { value: "texte", label: "Texte" },
      ]}
    />
  );
}

function Notice({
  icon,
  tone = "warning",
  children,
}: {
  icon: ReactNode;
  tone?: "warning" | "info";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-3 text-sm leading-5",
        tone === "info"
          ? "border-primary/20 bg-primary-soft/50 text-primary-strong"
          : "border-warning/30 bg-warning-soft/60 text-warning-strong",
      )}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}

/** Figma radio card (Fidèle / Optimisé). */
function ModeOption({
  title,
  description,
  icon,
  badge,
  active,
  onClick,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  badge?: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-2.5 rounded-2xl border bg-card p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/10",
        active ? "border-primary" : "border-border/70 hover:border-border",
      )}
    >
      <span className="flex w-full items-center justify-between gap-4">
        <span className="flex items-center gap-2.5 text-base font-medium leading-[17px] text-foreground [&_svg]:size-[19px]">
          {icon}
          {title}
        </span>
        {badge}
      </span>
      <span className="text-sm font-medium leading-6 text-muted-foreground">{description}</span>
    </button>
  );
}

function ResourceRow({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-base leading-6 text-muted-foreground">
      <ArrowRight className="mt-[3px] size-[17px] shrink-0 text-primary" />
      <span>{children}</span>
    </li>
  );
}

function SummaryRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between text-base leading-6">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", muted ? "text-muted-foreground" : "text-foreground")}>{value}</span>
    </div>
  );
}

type GenerationPhase = "idle" | "check" | "generate";

function SubmitButton({ phase, className }: { phase: GenerationPhase; className?: string }) {
  return (
    <Button type="submit" size="lg" disabled={phase !== "idle"} className={className}>
      {phase === "check" ? (
        <>
          <RefreshCw className="animate-spin" />
          Analyse du match...
        </>
      ) : phase === "generate" ? (
        <>
          <RefreshCw className="animate-spin" />
          Génération en cours...
        </>
      ) : (
        <>
          <WandSparkles />
          Générer le CV
        </>
      )}
    </Button>
  );
}

/**
 * Pipeline steps shown while the CV is generated. The first step maps to the real pre-check
 * request; generation steps advance on typical timings (the API answers in a single call) and the
 * last one stays "en cours" until the result arrives — it is never shown as done before that.
 */
const GENERATION_STEPS = [
  { label: "Lecture de l’annonce", after: 0 },
  { label: "Sélection des expériences", after: 0 },
  { label: "Rédaction du CV", after: 8 },
  { label: "Évaluation du résultat", after: 22 },
] as const;

function GenerationProgress({ phase, compact = false }: { phase: "check" | "generate"; compact?: boolean }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const current =
    phase === "check"
      ? 0
      : GENERATION_STEPS.reduce((index, step, i) => (i > 0 && elapsed >= step.after ? i : index), 1);

  if (compact) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        <span className="size-2 animate-pulse rounded-full bg-primary" />
        {GENERATION_STEPS[current].label}… <span className="tabular-nums">{elapsed}s</span>
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/85 px-5 py-5" aria-live="polite">
      {GENERATION_STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step.label} className="flex items-center gap-3 text-base leading-6">
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border",
                done && "border-success bg-success text-primary-foreground",
                active && "border-primary",
                !done && !active && "border-border",
              )}
            >
              {done ? <Check className="size-3" /> : active ? <span className="size-2 animate-pulse rounded-full bg-primary" /> : null}
            </span>
            <span className={cn(done || active ? "text-foreground" : "text-muted-foreground", active && "font-medium")}>{step.label}</span>
            {active ? <span className="ml-auto text-sm tabular-nums text-muted-foreground">{elapsed}s</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export default function Tailor() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const generate = useGenerateTailor();
  const checkMatch = useCheckMatch();

  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("optimise");
  const [inputMode, setInputMode] = useState<InputMode>("lien");
  const [urlConverted, setUrlConverted] = useState(false);
  const [introMaxChars, setIntroMaxChars] = useState("");
  const [bodyMaxChars, setBodyMaxChars] = useState("");
  const [extraContext, setExtraContext] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [scrapeFailReason, setScrapeFailReason] = useState<string | null>(null);
  const [scrapeNotice, setScrapeNotice] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    try {
      const rawPrefs = window.localStorage.getItem(TAILOR_PREFS_KEY);
      if (!rawPrefs) return;

      const parsed = JSON.parse(rawPrefs) as { introMaxChars?: string; bodyMaxChars?: string };
      if (typeof parsed.introMaxChars === "string") setIntroMaxChars(parsed.introMaxChars);
      if (typeof parsed.bodyMaxChars === "string") setBodyMaxChars(parsed.bodyMaxChars);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(TAILOR_PREFS_KEY, JSON.stringify({ introMaxChars, bodyMaxChars }));
    } catch {
      return;
    }
  }, [introMaxChars, bodyMaxChars]);

  useEffect(() => {
    try {
      const state = window.history.state;
      if (!state?.tailorPrefill) return;

      const { text: prefillText, url: prefillUrl } = state.tailorPrefill;
      window.history.replaceState({}, "", "/tailor");

      if (prefillUrl && prefillUrl.startsWith("http")) {
        const { url: normalized, converted } = normalizeLinkedInUrl(prefillUrl);
        setUrl(normalized);
        setUrlConverted(converted);
        setInputMode("lien");
      } else if (prefillText) {
        const cleaned = prefillText.replace(/^Mock extracted description for .*/gm, "").trim();
        if (cleaned) {
          setText(cleaned);
          setInputMode("texte");
        }
      }
    } catch {
      return;
    }
  }, []);

  const urlWarning = getUrlWarning(url);
  const hasAnnouncement = Boolean(url.trim() || text.trim());
  const verdictMeta = getPrecheckVerdictMeta(pendingConfirm?.verdict);
  const fastLaneMode = mode === "optimise" ? "Optimisé" : "Fidèle";
  const fastLaneAnnouncement = hasAnnouncement ? "Renseignée" : "À ajouter";
  const fastLaneLimits = introMaxChars || bodyMaxChars ? "Personnalisées" : "Auto";
  const hasAdvancedValues = Boolean(introMaxChars || bodyMaxChars || extraContext.trim());
  const phase: GenerationPhase = checkMatch.isPending ? "check" : generate.isPending ? "generate" : "idle";

  const handleUrlChange = (value: string) => {
    const { url: normalized, converted } = normalizeLinkedInUrl(value);
    setUrl(normalized);
    setUrlConverted(converted);
    setScrapeFailReason(null);
    setScrapeNotice(null);
  };

  const doGenerate = async () => {
    try {
      const introChars = introMaxChars ? parseInt(introMaxChars, 10) : undefined;
      const bodyChars = bodyMaxChars ? parseInt(bodyMaxChars, 10) : undefined;

      const run = await generate.mutateAsync({
        url: url || undefined,
        text: text || undefined,
        mode: mode === "fidele" ? "original" : "polished",
        introMaxChars: introChars && introChars >= 50 ? introChars : undefined,
        bodyMaxChars: bodyChars && bodyChars >= 500 ? bodyChars : undefined,
        extraContext: extraContext.trim() || undefined,
      });

      toast({ title: "CV généré", description: "Ton CV a été optimisé." });
      setLocation(`/results/${run.id}`);
    } catch (error) {
      toast({ title: "Erreur", description: (error as Error).message, variant: "destructive" });
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!url && !text) {
      toast({
        title: "Champ requis",
        description: "Colle une URL ou le texte de l'annonce.",
        variant: "destructive",
      });
      return;
    }

    try {
      const check = await checkMatch.mutateAsync({
        url: url || undefined,
        text: text || undefined,
        extraContext: extraContext.trim() || undefined,
      });

      setScrapeNotice(
        check.jobInput?.scrapeQuality === "uncertain"
          ? check.jobInput.scrapeMessage || "Annonce partiellement bruitée : le score est à lire avec prudence."
          : null,
      );

      if (check.shouldWarn) {
        setPendingConfirm({
          score: check.preliminaryConfidence,
          jobTitle: check.jobTitle,
          verdict: check.precheckVerdict,
          message: check.warningMessage,
        });
        return;
      }
    } catch (error) {
      const message = (error as Error).message;
      if (
        url &&
        !text &&
        /colle le texte|je n'ai pas pu lire|bloque la recuperation|impossible de recuperer/i.test(message)
      ) {
        setScrapeFailReason(message);
        return;
      }
    }

    await doGenerate();
  };

  return (
    <>
      <Layout>
        <div className="flex flex-col gap-6 pb-6">
          <PageHeader
            eyebrow="Tailoring"
            title="Adapter ton CV à une offre"
            description="Colle une offre pour extraire les attentes clés et ajuster ton CV."
          />

          <form onSubmit={handleSubmit} className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_388px]">
            <div className="flex min-w-0 flex-col gap-7">
              {/* ── Annonce cible ─────────────────────────────────────────── */}
              <Card variant="panel" className="overflow-hidden">
                <div className="border-b border-border/60 bg-secondary/20 px-6 pb-5 pt-5 md:px-[34px]">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex flex-col gap-1">
                      <Eyebrow>Annonce cible</Eyebrow>
                      <h2 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">Colle l’offre complète ou un extrait</h2>
                    </div>
                    <p className="flex items-center gap-2.5 text-base font-medium text-primary">
                      <Target className="size-[17px]" />
                      Plus l’offre est précise, plus l’analyse est fiable
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-5 p-6 md:p-[34px]">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex flex-col gap-2">
                      <h3 className="text-xl font-semibold leading-6 text-foreground">Ajoute une offre</h3>
                      <p className="text-base text-muted-foreground">Colle un lien ou du texte pour servir de base à l’adaptation.</p>
                    </div>
                    <InputModeSwitch value={inputMode} onChange={setInputMode} />
                  </div>

                  {inputMode === "lien" ? (
                    <div className="flex flex-col gap-3">
                      <div className="relative">
                        <Link2 className="pointer-events-none absolute left-[15px] top-1/2 size-[19px] -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={url}
                          onChange={(event) => handleUrlChange(event.target.value)}
                          placeholder="Colle un lien vers l’annonce LinkedIn, Welcome to the Jungle, etc..."
                          className="h-[58px] pl-12"
                        />
                      </div>

                      {urlWarning ? (
                        <Notice icon={<AlertTriangle className="mt-0.5 size-4 shrink-0" />}>{urlWarning}</Notice>
                      ) : null}

                      {urlConverted && !urlWarning ? (
                        <Notice tone="info" icon={<Info className="mt-0.5 size-4 shrink-0" />}>
                          URL LinkedIn convertie automatiquement pour une récupération plus stable.
                        </Notice>
                      ) : null}

                      {scrapeFailReason ? (
                        <Notice icon={<AlertTriangle className="mt-0.5 size-4 shrink-0" />}>
                          {scrapeFailReason} Colle le texte pour continuer.
                        </Notice>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {scrapeNotice ? (
                        <Notice icon={<Info className="mt-0.5 size-4 shrink-0" />}>{scrapeNotice}</Notice>
                      ) : null}

                      <Textarea
                        value={text}
                        onChange={(event) => {
                          setText(event.target.value);
                          if (event.target.value) setScrapeNotice(null);
                        }}
                        placeholder="Colle le texte brut de l’annonce ici..."
                        className="min-h-[260px]"
                      />
                    </div>
                  )}
                </div>
              </Card>

              {/* ── Mode ─────────────────────────────────────────────────── */}
              <Card variant="panel" className="flex flex-col gap-5 p-6">
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-2.5">
                    <SlidersHorizontal className="size-[19px] text-foreground" />
                    <h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Mode</h3>
                  </div>
                  <p className="text-base leading-6 text-muted-foreground">Choisis comment le CV est retravaillé.</p>
                </div>

                <div role="radiogroup" aria-label="Mode de génération" className="grid gap-3.5 md:grid-cols-2">
                  <ModeOption
                    title="Optimisé"
                    description="Le meilleur mode pour candidater vite, sans changer le fond."
                    icon={<Sparkles className="text-primary" />}
                    badge={<Badge variant="default" className="font-semibold uppercase tracking-[0.14em]">Recommandé</Badge>}
                    active={mode === "optimise"}
                    onClick={() => setMode("optimise")}
                  />
                  <ModeOption
                    title="Fidèle"
                    description="Idéal pour voir la sélection brute, sans modification."
                    icon={<FileText className="text-muted-foreground" />}
                    badge={<span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Brut</span>}
                    active={mode === "fidele"}
                    onClick={() => setMode("fidele")}
                  />
                </div>
              </Card>

              {/* ── Options avancées (repliées par défaut) ───────────────── */}
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <Card variant="panel" className="overflow-hidden">
                  <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 p-6 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-primary/10">
                    <span className="flex flex-col gap-1">
                      <span className="text-xl font-semibold tracking-[-0.025em] text-foreground">
                        Options avancées <span className="font-medium text-muted-foreground">(optionnel)</span>
                      </span>
                      <span className="text-base leading-6 text-muted-foreground">
                        Longueurs et contexte recruteur. Laisse vide pour un résultat automatique.
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      {hasAdvancedValues ? <Badge variant="primary">Personnalisées</Badge> : null}
                      <ChevronDown className={cn("size-5 text-muted-foreground transition-transform", advancedOpen && "rotate-180")} />
                    </span>
                  </CollapsibleTrigger>

                  <CollapsibleContent className="flex flex-col gap-5 px-6 pb-6">
                    <div className="grid gap-3.5 md:grid-cols-2">
                      <div className="flex flex-col gap-2.5">
                        <Label htmlFor="intro-max" className="text-base font-medium text-muted-foreground">Intro (longueur)</Label>
                        <Input
                          id="intro-max"
                          type="number"
                          value={introMaxChars}
                          onChange={(event) => setIntroMaxChars(event.target.value)}
                          placeholder="Ex: 300"
                        />
                      </div>

                      <div className="flex flex-col gap-2.5">
                        <Label htmlFor="body-max" className="text-base font-medium text-muted-foreground">Expériences (longueur)</Label>
                        <Input
                          id="body-max"
                          type="number"
                          value={bodyMaxChars}
                          onChange={(event) => setBodyMaxChars(event.target.value)}
                          placeholder="Ex: 3400"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2.5">
                      <Label htmlFor="extra-context" className="text-base font-medium text-muted-foreground">Contexte additionnel</Label>
                      <Textarea
                        id="extra-context"
                        value={extraContext}
                        onChange={(event) => setExtraContext(event.target.value)}
                        maxLength={1000}
                        placeholder="Ex : Le recruteur cherche surtout quelqu'un capable de structurer les pratiques design dans une équipe produit déjà mature."
                        className="min-h-[140px]"
                      />
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            </div>

            {/* ── Aside ──────────────────────────────────────────────────── */}
            <aside className="flex flex-col gap-5 xl:sticky xl:top-6 xl:self-start">
              <Card variant="panel" className="hidden flex-col gap-5 border-primary/20 bg-highlight-panel p-6 xl:flex">
                <div className="flex flex-col gap-2">
                  <Eyebrow>Fast lane</Eyebrow>
                  <h2 className="text-3xl font-semibold tracking-[-0.02em] text-foreground">Lancer le tailoring</h2>
                  <p className="text-base leading-6 text-muted-foreground">Une fois l’annonce collée, tout part d’ici.</p>
                </div>

                {phase !== "idle" ? (
                  <GenerationProgress phase={phase} />
                ) : (
                  <div className="flex flex-col gap-3.5 rounded-2xl border border-border/60 bg-card/85 px-5 py-[30px]">
                    <SummaryRow label="Mode" value={fastLaneMode} />
                    <SummaryRow label="Annonce" value={fastLaneAnnouncement} muted={!hasAnnouncement} />
                    <SummaryRow label="Limites" value={fastLaneLimits} />
                  </div>
                )}

                <SubmitButton phase={phase} className="w-full" />
              </Card>

              <Card variant="tint" className="relative min-h-[384px] overflow-hidden p-6">
                <h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Repères utiles</h3>
                <ul className="mt-4 flex flex-col gap-4">
                  <ResourceRow>Utilise le texte brut si une annonce est longue, répétitive ou mal scrappée.</ResourceRow>
                  <ResourceRow>Passe en fidèle si tu veux juger la sélection pure avant toute reformulation.</ResourceRow>
                  <ResourceRow>Garde les limites en auto si ton template n’impose pas de contrainte stricte.</ResourceRow>
                </ul>

                <Mascot variant="megaphone" flip className="absolute bottom-0 right-0 h-[117px] w-[137px] opacity-90" imgClassName="object-cover object-top" />
              </Card>
            </aside>

            {/* Mobile / tablet: the action stays reachable without scrolling past the form. */}
            <div className="sticky bottom-0 z-20 -mx-4 flex flex-col gap-3 border-t border-border/70 bg-background/90 px-4 py-3 backdrop-blur-xl md:-mx-8 md:px-8 xl:hidden">
              {phase !== "idle" ? <GenerationProgress phase={phase} compact /> : null}
              <SubmitButton phase={phase} className="w-full" />
            </div>
          </form>
        </div>
      </Layout>

      <AlertDialog open={!!pendingConfirm} onOpenChange={(open) => !open && setPendingConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{verdictMeta.label} - générer quand même ?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Triage rapide : <strong className={verdictMeta.emphasisClassName}>{verdictMeta.label}</strong>
                {pendingConfirm?.jobTitle ? <> pour <em>{pendingConfirm.jobTitle}</em></> : null}.
              </span>
              <span className="block text-muted-foreground">{verdictMeta.description}</span>
              <span className="block text-muted-foreground">
                {pendingConfirm?.message ? <span className="mb-1 block">{pendingConfirm.message}</span> : null}
                Score indicatif : <strong className={verdictMeta.emphasisClassName}>{pendingConfirm?.score}%</strong>. Le jugement final se fait sur le CV généré, pas sur ce pre-check seul.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingConfirm(null)}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setPendingConfirm(null);
                await doGenerate();
              }}
              className={buttonVariants({ variant: "destructive" })}
            >
              Générer quand même
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

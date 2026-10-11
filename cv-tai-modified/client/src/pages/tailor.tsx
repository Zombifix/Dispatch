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
        "group flex w-full items-start gap-3.5 rounded-2xl border p-4 text-left transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/10",
        active ? "border-primary bg-primary-soft/25 shadow-card" : "border-border/70 bg-card hover:border-primary/30",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          active ? "border-primary" : "border-border group-hover:border-primary/40",
        )}
        aria-hidden
      >
        <span className={cn("size-2 rounded-full bg-primary transition-transform", active ? "scale-100" : "scale-0")} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex w-full items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-base font-semibold text-foreground [&_svg]:size-4">
            {icon}
            {title}
          </span>
          {badge}
        </span>
        <span className="text-sm leading-5 text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

function ResourceRow({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm leading-5 text-muted-foreground">
      <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" />
      <span>{children}</span>
    </li>
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
 * The generation pipeline, shown before (what will happen) and during (where we are) a run.
 * The first step maps to the real pre-check request; generation steps advance on typical timings
 * (the API answers in a single call) and the last one stays "en cours" until the result arrives —
 * it is never shown as done before that.
 */
const GENERATION_STEPS = [
  { label: "Lecture de l’annonce", hint: "Titre, attentes, mots-clés ATS, positionnement.", after: 0 },
  { label: "Sélection des expériences", hint: "Les bullets les plus pertinents de ton Super CV.", after: 0 },
  { label: "Rédaction du CV", hint: "Reformulation ancrée dans tes preuves, rien d’inventé.", after: 8 },
  { label: "Évaluation du résultat", hint: "Pertinence, crédibilité et score ATS du document.", after: 22 },
] as const;

function useElapsed(phase: GenerationPhase) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    if (phase === "idle") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);
  return elapsed;
}

function currentStep(phase: GenerationPhase, elapsed: number) {
  if (phase === "idle") return -1;
  if (phase === "check") return 0;
  return GENERATION_STEPS.reduce((index, step, i) => (i > 0 && elapsed >= step.after ? i : index), 1);
}

function GenerationStatusLine({ phase }: { phase: GenerationPhase }) {
  const elapsed = useElapsed(phase);
  const current = currentStep(phase, elapsed);
  if (current < 0) return null;
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
      <span className="size-2 animate-pulse rounded-full bg-primary" />
      {GENERATION_STEPS[current].label}… <span className="tabular-nums">{elapsed}s</span>
    </p>
  );
}

function PipelineSteps({ phase }: { phase: GenerationPhase }) {
  const elapsed = useElapsed(phase);
  const current = currentStep(phase, elapsed);

  return (
    <ol className="relative flex flex-col" aria-live="polite">
      {GENERATION_STEPS.map((step, i) => {
        const done = current >= 0 && i < current;
        const active = i === current;
        const last = i === GENERATION_STEPS.length - 1;
        return (
          <li key={step.label} className="relative flex gap-4 pb-5 last:pb-0">
            {!last ? (
              <span
                className={cn(
                  "absolute left-[13px] top-7 h-[calc(100%-28px)] w-px",
                  done ? "bg-success" : "bg-border",
                )}
                aria-hidden
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors",
                done && "border-success bg-success text-primary-foreground",
                active && "border-primary bg-primary text-primary-foreground shadow-nav",
                !done && !active && "border-border bg-card text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
              <span className="flex items-center justify-between gap-2">
                <span className={cn("text-sm font-semibold", done || active ? "text-foreground" : "text-foreground/80")}>{step.label}</span>
                {active ? <span className="text-xs font-medium tabular-nums text-primary">{elapsed}s</span> : null}
              </span>
              <span className="text-sm leading-5 text-muted-foreground">{step.hint}</span>
            </span>
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
  const fastLaneMode = mode === "optimise" ? "optimisé" : "fidèle";
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
        <div className="flex flex-col gap-8 pb-6">
          <PageHeader
            eyebrow="Tailoring"
            title="Adapter ton CV à une offre"
            description="Colle une offre : le moteur sélectionne tes meilleures preuves et ajuste ton CV."
          />

          <form onSubmit={handleSubmit} className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
            {/* ── Composer: one surface, three numbered steps, action at the bottom ── */}
            <Card variant="panel" className="min-w-0 overflow-hidden">
              {/* 01 — L'annonce */}
              <section className="flex flex-col gap-5 p-6 md:p-8" aria-labelledby="step-offer">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Eyebrow id="step-offer">L’annonce</Eyebrow>
                  <InputModeSwitch value={inputMode} onChange={setInputMode} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <h2 className="text-2xl font-bold tracking-[-0.025em] text-foreground md:text-3xl">
                    {inputMode === "lien" ? "Colle le lien de l’offre" : "Colle le texte de l’offre"}
                  </h2>
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Target className="size-4 text-primary" />
                    Plus l’offre est complète, plus l’analyse est fiable.
                  </p>
                </div>

                {inputMode === "lien" ? (
                  <div className="flex flex-col gap-3">
                    <div className="relative">
                      <Link2 className="pointer-events-none absolute left-5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={url}
                        onChange={(event) => handleUrlChange(event.target.value)}
                        placeholder="https://www.welcometothejungle.com/fr/companies/…"
                        className="h-16 rounded-2xl bg-secondary/30 pl-14 text-lg focus-visible:bg-card"
                        aria-label="Lien de l’offre"
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
                      placeholder="Colle le texte brut de l’annonce ici : intitulé, missions, profil recherché…"
                      className="min-h-[280px] bg-secondary/30 focus-visible:bg-card"
                      aria-label="Texte de l’offre"
                    />
                  </div>
                )}
              </section>

              {/* 02 — Le mode */}
              <section className="flex flex-col gap-4 border-t border-border/60 p-6 md:px-8" aria-labelledby="step-mode">
                <Eyebrow id="step-mode">Le mode</Eyebrow>
                <div role="radiogroup" aria-label="Mode de génération" className="grid gap-3 md:grid-cols-2">
                  <ModeOption
                    title="Optimisé"
                    description="Reformule pour coller à l’offre, sans changer le fond."
                    icon={<Sparkles className="text-primary" />}
                    badge={<Badge variant="primary" className="font-semibold">Recommandé</Badge>}
                    active={mode === "optimise"}
                    onClick={() => setMode("optimise")}
                  />
                  <ModeOption
                    title="Fidèle"
                    description="La sélection brute de tes bullets, sans réécriture."
                    icon={<FileText className="text-muted-foreground" />}
                    active={mode === "fidele"}
                    onClick={() => setMode("fidele")}
                  />
                </div>
              </section>

              {/* 03 — Options avancées */}
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="border-t border-border/60">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-primary/10 md:px-8">
                  <Eyebrow>Options avancées</Eyebrow>
                  <span className="flex shrink-0 items-center gap-3">
                    {hasAdvancedValues ? <Badge variant="primary">Personnalisées</Badge> : null}
                    <ChevronDown className={cn("size-5 text-muted-foreground transition-transform", advancedOpen && "rotate-180")} />
                  </span>
                </CollapsibleTrigger>

                <CollapsibleContent className="flex flex-col gap-5 px-6 pb-6 md:px-8">
                  <div className="grid gap-3.5 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="intro-max" className="text-sm font-medium text-foreground">Intro (longueur)</Label>
                      <Input
                        id="intro-max"
                        type="number"
                        value={introMaxChars}
                        onChange={(event) => setIntroMaxChars(event.target.value)}
                        placeholder="Ex : 300"
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label htmlFor="body-max" className="text-sm font-medium text-foreground">Expériences (longueur)</Label>
                      <Input
                        id="body-max"
                        type="number"
                        value={bodyMaxChars}
                        onChange={(event) => setBodyMaxChars(event.target.value)}
                        placeholder="Ex : 3400"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="extra-context" className="text-sm font-medium text-foreground">Contexte additionnel</Label>
                    <Textarea
                      id="extra-context"
                      value={extraContext}
                      onChange={(event) => setExtraContext(event.target.value)}
                      maxLength={1000}
                      placeholder="Ex : Le recruteur cherche surtout quelqu'un capable de structurer les pratiques design dans une équipe produit déjà mature."
                      className="min-h-[120px]"
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Action bar — the CTA lives with the input it acts on */}
              <div className="hidden items-center justify-between gap-4 border-t border-border/60 px-6 py-5 md:flex md:px-8">
                <div className="min-w-0">{phase !== "idle" ? <GenerationStatusLine phase={phase} /> : null}</div>
                <SubmitButton phase={phase} className="shrink-0" />
              </div>
            </Card>

            {/* ── Aside: what happens next + tips ── */}
            <aside className="flex flex-col gap-6 xl:sticky xl:top-6">
              <section className="flex flex-col gap-5" aria-label="Étapes de génération">
                <div className="flex flex-col gap-1">
                  <h2 className="text-xl font-bold tracking-[-0.025em] text-foreground">
                    {phase === "idle" ? "4 étapes, environ 30 secondes" : "Ton CV se prépare"}
                  </h2>
                </div>
                <PipelineSteps phase={phase} />
              </section>

              <Card variant="tint" className="relative overflow-hidden p-5 pr-28">
                <p className="text-sm font-semibold text-foreground">Repères utiles</p>
                <ul className="mt-3 flex flex-col gap-2.5">
                  <ResourceRow>Annonce longue ou mal récupérée ? Passe en texte.</ResourceRow>
                  <ResourceRow>Mode fidèle pour juger la sélection brute.</ResourceRow>
                  <ResourceRow>Limites en auto si ton template n’impose rien.</ResourceRow>
                </ul>
                <Mascot variant="megaphone" flip className="absolute -right-2 bottom-0 h-[112px] w-[124px]" imgClassName="object-cover object-top" />
              </Card>
            </aside>

            {/* Mobile: the action stays reachable without scrolling past the form. */}
            <div className="sticky bottom-0 z-20 -mx-4 flex flex-col gap-3 border-t border-border/70 bg-background/90 px-4 py-3 backdrop-blur-xl md:hidden">
              {phase !== "idle" ? <GenerationStatusLine phase={phase} /> : null}
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

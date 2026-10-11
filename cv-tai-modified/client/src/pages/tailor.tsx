import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { useGenerateTailor, useCheckMatch } from "@/hooks/use-tailor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  FileText,
  Info,
  Link2,
  RefreshCw,
  Sparkles,
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
const PANEL_CLASS = "rounded-[33.903px] border border-[rgba(225,231,239,0.7)] bg-[rgba(255,255,255,0.75)]";
const FIELD_CLASS =
  "h-[53px] rounded-[26.638px] border-[rgba(225,231,239,0.7)] bg-white px-[15px] text-[16px] text-[#0f1729] placeholder:text-[#65758b] focus-visible:ring-2 focus-visible:ring-[#6467f2]/20 focus-visible:ring-offset-0";
const TEXTAREA_CLASS =
  "rounded-[26.638px] border-[rgba(225,231,239,0.7)] bg-white px-[15px] py-[18px] text-[16px] leading-[24px] text-[#0f1729] placeholder:text-[#65758b] focus-visible:ring-2 focus-visible:ring-[#6467f2]/20 focus-visible:ring-offset-0";

type Mode = "assemblage" | "fidele" | "optimise";
type AngleChoice = "auto" | "ic" | "lead" | "consultant" | "manager";
type LanguageChoice = "auto" | "FR" | "EN";
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
        emphasisClassName: "text-green-600",
        description: "Le triage rapide voit assez de signaux pour lancer la génération sereinement.",
      };
    case "prudence":
      return {
        label: "Prudence",
        emphasisClassName: "text-amber-600",
        description: "Le triage rapide reste ouvert, mais l'annonce demande une lecture plus fine ou une source plus propre.",
      };
    case "faible_chance":
      return {
        label: "Faible chance",
        emphasisClassName: "text-red-600",
        description: "Le triage rapide voit peu de preuves directes pour cette offre à ce stade.",
      };
    default:
      return {
        label: "Pre-check",
        emphasisClassName: "text-[#65758f]",
        description: "Le triage rapide reste un signal indicatif avant la génération complète.",
      };
  }
}

function InputModeSwitch({ value, onChange }: { value: InputMode; onChange: (value: InputMode) => void }) {
  const isLink = value === "lien";

  return (
    <div className="flex items-center gap-[14px] text-[16px] text-[#65758b]">
      <button
        type="button"
        className={isLink ? "font-medium text-[#0f1729]" : "font-normal"}
        onClick={() => onChange("lien")}
      >
        Lien
      </button>

      <button
        type="button"
        role="switch"
        aria-checked={!isLink}
        aria-label="Basculer entre lien et texte"
        onClick={() => onChange(isLink ? "texte" : "lien")}
        className="relative h-7 w-[52px] rounded-full bg-[#d7dce5] transition-colors"
      >
        <span
          className={[
            "absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-all",
            isLink ? "left-1" : "left-[27px]",
          ].join(" ")}
        />
      </button>

      <button
        type="button"
        className={!isLink ? "font-medium text-[#0f1729]" : "font-normal"}
        onClick={() => onChange("texte")}
      >
        Texte
      </button>
    </div>
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
  const palette =
    tone === "info"
      ? "border-[#ced8ff] bg-[#edf2ff] text-[#4d63cb]"
      : "border-[#ead6a3] bg-[#fff7e6] text-[#8a6c2b]";

  return <div className={`flex items-start gap-2 rounded-[18px] border px-3 py-3 text-[13px] leading-[18px] ${palette}`}>{icon}<span>{children}</span></div>;
}

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
      onClick={onClick}
      className={[
        "w-full rounded-[26.638px] border p-[20.584px] text-left transition-colors",
        active ? "border-[#6467f2] bg-transparent" : "border-[rgba(225,231,239,0.7)] bg-white",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-[9.687px] text-[#0f1729]">
          {icon}
          <span className="text-[16px] font-medium leading-[16.951px]">{title}</span>
        </div>
        {badge}
      </div>
      <p className="mt-[9.687px] max-w-[295px] text-[14px] font-medium leading-[24.216px] text-[#65758b]">{description}</p>
    </button>
  );
}

function ResourceRow({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-[16px] leading-[24.216px] text-[#65758b]">
      <ArrowRight className="h-[16.951px] w-[16.951px] flex-shrink-0 text-[#6467f2]" />
      <span>{children}</span>
    </li>
  );
}

export default function Tailor() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const generate = useGenerateTailor();
  const checkMatch = useCheckMatch();

  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("assemblage");
  const [angle, setAngle] = useState<AngleChoice>("auto");
  const [cvLanguage, setCvLanguage] = useState<LanguageChoice>("auto");
  const [inputMode, setInputMode] = useState<InputMode>("lien");
  const [urlConverted, setUrlConverted] = useState(false);
  const [introMaxChars, setIntroMaxChars] = useState("");
  const [bodyMaxChars, setBodyMaxChars] = useState("");
  const [extraContext, setExtraContext] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [scrapeFailReason, setScrapeFailReason] = useState<string | null>(null);
  const [scrapeNotice, setScrapeNotice] = useState<string | null>(null);

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
  const isBusy = checkMatch.isPending || generate.isPending;
  const verdictMeta = getPrecheckVerdictMeta(pendingConfirm?.verdict);
  const fastLaneMode = mode === "assemblage" ? "Assemblage" : mode === "optimise" ? "Optimise" : "Fidele";
  const fastLaneAnnouncement = hasAnnouncement ? "Renseignee" : "A remplir";
  const fastLaneLimits = introMaxChars || bodyMaxChars ? "Personnalisees" : "Auto";

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
        mode: mode === "assemblage" ? "assembly" : mode === "fidele" ? "original" : "polished",
        angle: mode === "assemblage" && angle !== "auto" ? angle : undefined,
        language: mode === "assemblage" && cvLanguage !== "auto" ? cvLanguage : undefined,
        introMaxChars: introChars && introChars >= 50 ? introChars : undefined,
        bodyMaxChars: bodyChars && bodyChars >= 500 ? bodyChars : undefined,
        extraContext: extraContext.trim() || undefined,
      });

      toast({ title: "CV généré", description: mode === "assemblage" ? "Assemblé à partir de tes formulations." : "Sélection et retouches terminées." });
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

    if (mode === "assemblage") {
      await doGenerate();
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
        <div className="mx-auto w-full max-w-[1427px] pb-6">
          <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-background/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <WandSparkles className="h-3.5 w-3.5 text-primary" />
                Tailoring
              </div>
              <h1 className="text-4xl font-extrabold tracking-tight text-foreground">Adapter ton CV à une offre</h1>
              <p className="text-xl text-muted-foreground">Colle une offre pour extraire les attentes clés et ajuster ton CV.</p>
            </div>
          </section>

          <form onSubmit={handleSubmit} className="mt-8 grid gap-[29px] xl:grid-cols-[minmax(0,1010px)_388px]">
            <div className="space-y-[29px]">
              <section className={`${PANEL_CLASS} overflow-hidden`}>
                {/* Header with border-bottom */}
                <div className="border-b border-[rgba(225,231,239,0.6)] bg-[rgba(241,245,249,0.2)] px-[33px] py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-[14px] font-semibold uppercase tracking-[2.9px] text-[#65758b]">Annonce cible</p>
                      <h2 className="text-[24px] font-semibold tracking-[-0.025em] text-[#0f1729]">Colle l'offre complète ou un extrait</h2>
                    </div>
                    <div className="flex items-center gap-2 text-[16px] font-medium text-[#2563eb]">
                      <Info className="h-[17px] w-[17px]" />
                      Plus l'offre est précise, plus l'analyse est fiable
                    </div>
                  </div>
                </div>
                {/* Body */}
                <div className="p-[33px]">
                  <div className="space-y-[19px]">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-1">
                        <h3 className="text-[19px] font-semibold text-[#0f1729]">Ajoute une offre</h3>
                        <p className="text-[17px] text-[#65758b]">Colle un lien ou du texte pour servir de base à l'adaptation.</p>
                      </div>
                      <InputModeSwitch value={inputMode} onChange={setInputMode} />
                    </div>

                    {inputMode === "lien" ? (
                      <div className="space-y-3">
                        <div className="relative">
                          <Link2 className="absolute left-[17px] top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#65758b]" />
                          <Input
                            value={url}
                            onChange={(event) => handleUrlChange(event.target.value)}
                            placeholder="Colle un lien vers l'annonce LinkedIn, Welcome to the Jungle, etc..."
                            className={`${FIELD_CLASS} pl-[44px]`}
                          />
                        </div>

                        {urlWarning ? (
                          <Notice icon={<AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />}>{urlWarning}</Notice>
                        ) : null}

                        {urlConverted && !urlWarning ? (
                          <Notice tone="info" icon={<Info className="mt-0.5 h-4 w-4 flex-shrink-0" />}>
                            URL LinkedIn convertie automatiquement pour une récupération plus stable.
                          </Notice>
                        ) : null}

                        {scrapeFailReason ? (
                          <Notice icon={<AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />}>
                            {scrapeFailReason} Colle le texte pour continuer.
                          </Notice>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {scrapeNotice ? (
                          <Notice icon={<Info className="mt-0.5 h-4 w-4 flex-shrink-0" />}>{scrapeNotice}</Notice>
                        ) : null}

                        <Textarea
                          value={text}
                          onChange={(event) => {
                            setText(event.target.value);
                            if (event.target.value) setScrapeNotice(null);
                          }}
                          placeholder="Colle le texte brut de l'annonce ici..."
                          className={`min-h-[260px] ${TEXTAREA_CLASS}`}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <div className="grid gap-[29px] xl:grid-cols-[minmax(0,1fr)_387px]">
                <section className={`${PANEL_CLASS} p-[25.427px]`}>
                  <div className="space-y-[10px]">
                    <h3 className="text-[20px] font-semibold tracking-[-0.024em] text-[#0f1729]">
                      RÉGLAGES <span className="font-medium text-[#5e5b73]">(optionnel)</span>
                    </h3>
                    <p className="max-w-[542px] text-[16px] leading-[24.216px] text-[#65758b]">
                      Laisse vide pour un comportement auto, ou contraints ton template si besoin.
                    </p>
                  </div>

                  <div className="mt-6 grid gap-[14px] md:grid-cols-2">
                    <div className="space-y-[10px]">
                      <Label className="text-[16px] font-medium leading-[19.373px] text-[#65758b]">Intro (longueur)</Label>
                      <Input
                        type="number"
                        value={introMaxChars}
                        onChange={(event) => setIntroMaxChars(event.target.value)}
                        placeholder="Ex: 300"
                        className={FIELD_CLASS}
                      />
                    </div>

                    <div className="space-y-[10px]">
                      <Label className="text-[16px] font-medium leading-[19.373px] text-[#65758b]">Expériences (longueur)</Label>
                      <Input
                        type="number"
                        value={bodyMaxChars}
                        onChange={(event) => setBodyMaxChars(event.target.value)}
                        placeholder="Ex: 3400"
                        className={FIELD_CLASS}
                      />
                    </div>
                  </div>

                  <div className="mt-[19px] space-y-[10px]">
                    <Label className="text-[16px] font-medium leading-[19.373px] text-[#65758b]">Contexte additionnel</Label>
                    <Textarea
                      value={extraContext}
                      onChange={(event) => setExtraContext(event.target.value)}
                      maxLength={1000}
                      placeholder="Ex : Le recruteur cherche surtout quelqu'un capable de structurer les pratiques design dans une equipe produit deja mature."
                      className={`min-h-[170px] ${TEXTAREA_CLASS}`}
                    />
                  </div>
                </section>

                <section className={`${PANEL_CLASS} p-[25.427px]`}>
                  <div className="space-y-[10px]">
                    <div className="flex items-center gap-[10px]">
                      <Sparkles className="h-[19px] w-[19px] text-[#6467f2]" />
                      <h3 className="text-[20px] font-semibold tracking-[-0.024em] text-[#0f1729]">Mode</h3>
                    </div>
                    <p className="text-[16px] leading-[24.216px] text-[#65758b]">
                      Assemblage : tes formulations, sans IA. Les autres modes utilisent l'IA pour lire et sélectionner.
                    </p>
                  </div>

                  <div className="mt-[19px] space-y-[14px]">
                    <ModeOption
                      title="Assemblage"
                      description="Tes propres formulations, choisies pour l'offre. Instantané, sans réécriture IA."
                      icon={<FileText className="h-[19px] w-[19px] text-[#6467f2]" />}
                      badge={
                        <span className="rounded-full bg-[#6467f2] px-[10px] py-[4px] text-[12px] font-semibold uppercase tracking-[0.14em] text-[#f8fafc]">
                          Recommande
                        </span>
                      }
                      active={mode === "assemblage"}
                      onClick={() => setMode("assemblage")}
                    />

                    {mode === "assemblage" ? (
                      <div className="grid grid-cols-2 gap-3" data-testid="assembly-options">
                        <label className="space-y-1 text-[13px] text-[#65758b]">
                          <span>Angle</span>
                          <select value={angle} onChange={e => setAngle(e.target.value as AngleChoice)}
                            className="h-9 w-full rounded-xl border border-[rgba(225,231,239,0.9)] bg-white px-2 text-[14px] text-[#0f1729]">
                            <option value="auto">Selon l'offre</option>
                            <option value="ic">Craft / delivery</option>
                            <option value="lead">Lead / vision</option>
                            <option value="consultant">Conseil</option>
                            <option value="manager">Management</option>
                          </select>
                        </label>
                        <label className="space-y-1 text-[13px] text-[#65758b]">
                          <span>Langue du CV</span>
                          <select value={cvLanguage} onChange={e => setCvLanguage(e.target.value as LanguageChoice)}
                            className="h-9 w-full rounded-xl border border-[rgba(225,231,239,0.9)] bg-white px-2 text-[14px] text-[#0f1729]">
                            <option value="auto">Automatique</option>
                            <option value="FR">Français</option>
                            <option value="EN">Anglais</option>
                          </select>
                        </label>
                      </div>
                    ) : null}

                    <ModeOption
                      title="Fidele"
                      description="Sélection par l'IA, tes phrases telles quelles."
                      icon={<FileText className="h-[19px] w-[19px] text-[#65758b]" />}
                      badge={<span className="text-[13px] font-medium uppercase tracking-[0.18em] text-[#65758b]">Brut</span>}
                      active={mode === "fidele"}
                      onClick={() => setMode("fidele")}
                    />

                    <ModeOption
                      title="Optimise"
                      description="Sélection par l'IA et jusqu'à 3 retouches de vocabulaire, chacune annulable."
                      icon={<Sparkles className="h-[19px] w-[19px] text-[#6467f2]" />}
                      active={mode === "optimise"}
                      onClick={() => setMode("optimise")}
                    />
                  </div>
                </section>
              </div>
            </div>

            <aside className="space-y-[19px] xl:sticky xl:top-6 xl:self-start">
              <section
                className="rounded-[33.903px] border border-[rgba(100,103,242,0.2)] p-[25.427px]"
                style={{
                  backgroundImage:
                    "linear-gradient(180deg, rgba(127,129,249,0.08) 0%, rgba(255,255,255,1) 38%, rgba(255,255,255,1) 100%)",
                }}
              >
                <p className="text-[14px] font-semibold uppercase tracking-[0.2em] text-[#65758b]">Fast lane</p>
                <h2 className="mt-2 text-[32px] font-semibold tracking-[-0.02em] text-[#0f1729]">Lancer le tailoring</h2>
                <p className="mt-2 text-[16px] leading-[24.216px] text-[#65758b]">Une fois l'annonce collee, tout part d'ici.</p>

                <div className="mt-[19px] space-y-[14px] rounded-[26.638px] border border-[rgba(225,231,239,0.6)] bg-[rgba(255,255,255,0.85)] px-[20.584px] py-[30.271px]">
                  <div className="flex items-center justify-between text-[16px] leading-[24.216px]">
                    <span className="text-[#65758b]">Mode</span>
                    <span className="font-medium text-[#0f1729]">{fastLaneMode}</span>
                  </div>
                  <div className="flex items-center justify-between text-[16px] leading-[24.216px]">
                    <span className="text-[#65758b]">Annonce</span>
                    <span className={hasAnnouncement ? "font-medium text-[#0f1729]" : "font-medium text-[#65758b]"}>{fastLaneAnnouncement}</span>
                  </div>
                  <div className="flex items-center justify-between text-[16px] leading-[24.216px]">
                    <span className="text-[#65758b]">Limites</span>
                    <span className="font-medium text-[#0f1729]">{fastLaneLimits}</span>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isBusy}
                  className="mt-[19px] h-[58px] w-full rounded-[19.373px] border border-[#f8fafc] bg-[#6467f2] px-4 text-[19px] font-medium text-[#f8fafc] shadow-[0_12px_18px_-4px_rgba(100,103,242,0.2),0_5px_7px_-5px_rgba(100,103,242,0.2)] hover:bg-[#5b5ff0]"
                >
                  {checkMatch.isPending ? (
                    <>
                      <RefreshCw className="mr-2 h-[19px] w-[19px] animate-spin" />
                      Analyse du match...
                    </>
                  ) : null}

                  {generate.isPending ? (
                    <>
                      <RefreshCw className="mr-2 h-[19px] w-[19px] animate-spin" />
                      Generation en cours...
                    </>
                  ) : null}

                  {!checkMatch.isPending && !generate.isPending ? (
                    <>
                      <WandSparkles className="mr-2 h-[19px] w-[19px]" />
                      Generer le CV
                    </>
                  ) : null}
                </Button>
              </section>

              <section className="relative overflow-hidden rounded-[33.903px] border border-[rgba(225,231,239,0.7)] bg-[rgba(241,245,249,0.25)] px-[24.216px] pb-[30px] pt-[23.91px]">
                <h3 className="text-[20px] font-semibold tracking-[-0.024em] text-[#0f1729]">Repères utiles</h3>
                <ul className="mt-[16px] flex min-h-[188px] max-w-[316px] flex-col gap-[16px] pr-10">
                  <ResourceRow>Utilise le texte brut si une annonce est longue, repetitive ou mal scrappee.</ResourceRow>
                  <ResourceRow>Passe en fidele si tu veux juger la selection pure avant toute reformulation.</ResourceRow>
                  <ResourceRow>Garde les limites en auto si ton template n'impose pas de contrainte stricte.</ResourceRow>
                </ul>

                <img
                  src="/tailor-help-illustration.png"
                  alt="Illustration megaphone"
                  className="pointer-events-none absolute bottom-0 right-0 w-[138px]"
                />
              </section>
            </aside>
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Générer quand même
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

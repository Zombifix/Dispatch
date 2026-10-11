import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { format } from "date-fns";
import { Layout } from "@/components/layout";
import { useExperiences, useCreateExperience, useUpdateExperience, useDeleteExperience } from "@/hooks/use-experiences";
import { useBullets, useCreateBullet, useUpdateBullet, useDeleteBullet } from "@/hooks/use-bullets";
import { useSkills, useCreateSkill, useDeleteSkill } from "@/hooks/use-skills";
import { Card } from "@/components/ui/card";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { PageHeader, SectionTitle, Eyebrow } from "@/components/ui/page-header";
import { Mascot } from "@/components/brand/mascot";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Plus, Building, Calendar, Pencil, RefreshCw, Briefcase, Zap, Upload, Sparkles, Check, X, GraduationCap, Globe, ChevronDown, HelpCircle, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import type { Experience, Bullet } from "@shared/schema";

/* ══════════════════════════════════════════════════════════════════
   DEEP-LINK CONTEXT — read URL params from result page
   ══════════════════════════════════════════════════════════════════ */
interface EnrichmentContext {
  experienceId?: string;
  missingKeywords?: string[];
  jobTitle?: string;
}

function useEnrichmentContext(): EnrichmentContext {
  const [ctx, setCtx] = useState<EnrichmentContext>({});
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const experienceId = params.get("experienceId") || undefined;
    const missingRaw = params.get("missing") || "";
    const missingKeywords = missingRaw ? missingRaw.split(",").map(s => s.trim()).filter(Boolean) : undefined;
    const jobTitle = params.get("jobTitle") || undefined;
    if (experienceId || missingKeywords?.length) {
      setCtx({ experienceId, missingKeywords, jobTitle });
      // Clean URL without reload
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  return ctx;
}

/* ══════════════════════════════════════════════════════════════════
   TYPES
   ══════════════════════════════════════════════════════════════════ */
interface Gap { id: string; dimension: string; question: string; priority: number; }

type DepthInfo = {
  label: string;
  variant: "destructive" | "warning" | "success";
  dotClass: string;
  dots: number;
};

function getDepthInfo(bulletCount: number): DepthInfo {
  if (bulletCount === 0) return { label: "Vide", variant: "destructive", dotClass: "bg-destructive", dots: 0 };
  if (bulletCount <= 2) return { label: "Ébauche", variant: "warning", dotClass: "bg-warning", dots: 1 };
  if (bulletCount <= 4) return { label: "Structuré", variant: "success", dotClass: "bg-success", dots: 3 };
  return { label: "Complet", variant: "success", dotClass: "bg-success-strong", dots: 5 };
}

/** Selectable chip (contract type, category, language, level, extracted skills). */
function ChoiceChip({ selected, className, ...props }: ButtonProps & { selected: boolean }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-pressed={selected}
      className={cn(selected && "bg-primary-soft text-primary-strong hover:bg-primary-soft", className)}
      {...props}
    />
  );
}

/** Small inline remove control inside a chip/tag. */
function ChipRemoveButton({ className, ...props }: ButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn("size-4 rounded-xs hover:bg-transparent hover:text-destructive [&_svg]:size-3", className)}
      {...props}
    >
      <X />
    </Button>
  );
}

/* ══════════════════════════════════════════════════════════════════
   PROFILE HOOK
   ══════════════════════════════════════════════════════════════════ */
function useProfile() {
  const [profile, setProfile] = useState<any>({ name: "", title: "", summary: "", targetRole: "" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/profile", { credentials: "include" }).then(r => r.json()).then(p => {
      setProfile(p || { name: "", title: "", summary: "", targetRole: "" });
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const save = useCallback(async (updates: any) => {
    const merged = { ...profile, ...updates };
    setProfile(merged);
    await fetch("/api/profile", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates), credentials: "include",
    });
  }, [profile]);

  return { profile, save, loaded };
}

/* ══════════════════════════════════════════════════════════════════
   MAIN PAGE — Single page, no tabs
   ══════════════════════════════════════════════════════════════════ */
export default function Library() {
  const enrichmentContext = useEnrichmentContext();
  const { profile, save: saveProfile, loaded: profileLoaded } = useProfile();
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ name: "", title: "", summary: "" });

  useEffect(() => {
    if (profileLoaded) {
      setProfileDraft({ name: profile.name || "", title: profile.title || "", summary: profile.summary || "" });
    }
  }, [profileLoaded]);

  const handleSaveProfile = () => {
    saveProfile(profileDraft);
    setEditingProfile(false);
  };

  return (
    <Layout>
      <div className="flex flex-col gap-7">
        <PageHeader
          eyebrow="Super CV"
          title="Bibliothèque source"
          description="La base qui alimente tous tes tailorings."
        />

        {/* ── PROFILE HEADER ── */}
        <Card variant="panel" className="p-6 md:p-8">
          {editingProfile ? (
            <div className="flex flex-col gap-3 animate-in fade-in-50">
              <Input inputSize="sm" value={profileDraft.name} onChange={e => setProfileDraft({ ...profileDraft, name: e.target.value })}
                placeholder="Prénom Nom" className="h-auto rounded-none border-0 bg-transparent p-0 text-2xl font-semibold tracking-[-0.025em] focus-visible:ring-0" />
              <Input inputSize="sm" value={profileDraft.title} onChange={e => setProfileDraft({ ...profileDraft, title: e.target.value })}
                placeholder="Senior Product Designer" className="h-auto rounded-none border-0 bg-transparent p-0 text-base text-muted-foreground focus-visible:ring-0" />
              <Input inputSize="sm" value={profileDraft.summary} onChange={e => setProfileDraft({ ...profileDraft, summary: e.target.value })}
                placeholder="Une phrase qui te résume (optionnel)" className="h-auto rounded-none border-0 bg-transparent p-0 text-sm text-muted-foreground focus-visible:ring-0" />
              <div>
                <Button size="sm" onClick={handleSaveProfile}>Valider</Button>
              </div>
            </div>
          ) : (
            <div className="group flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">{profile.name || "Votre nom"}</h2>
                <p className="text-base text-muted-foreground">{profile.title || "Votre poste"}</p>
                {profile.summary && <p className="text-sm text-muted-foreground">{profile.summary}</p>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditingProfile(true)}>
                <Pencil />
                Modifier
              </Button>
            </div>
          )}
        </Card>

        {/* Main column: experiences (the core of the library). Aside: skills, education, languages. */}
        <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_420px]">
          <ExperiencesSection enrichmentContext={enrichmentContext} />

          <div className="flex flex-col gap-7 xl:sticky xl:top-6">
            <SkillsSection />
            <FormationsSection />
            <LanguagesSection />
          </div>
        </div>

      </div>
    </Layout>
  );
}

/* ══════════════════════════════════════════════════════════════════
   EXPERIENCES SECTION — Accordion + Enrichment Sheet
   ══════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════
   EXPERIENCES SECTION — Accordion + Enrichment Sheet
   ══════════════════════════════════════════════════════════════════ */
function ExperiencesSection({ enrichmentContext }: { enrichmentContext?: EnrichmentContext }) {
  const { data: experiences, isLoading } = useExperiences();
  const [editOpen, setEditOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingExp, setEditingExp] = useState<any>(null);
  const [enrichingExpId, setEnrichingExpId] = useState<string | null>(null);
  const [editBulletId, setEditBulletId] = useState<string | null>(null);
  const [enrichmentMissing, setEnrichmentMissing] = useState<string[] | undefined>(undefined);
  const [enrichmentJobTitle, setEnrichmentJobTitle] = useState<string | undefined>(undefined);
  const [autoOpened, setAutoOpened] = useState(false);

  // Stable sort: compute once, don't re-sort on edits
  const sortedExperiences = useMemo(() => {
    if (!experiences) return [];
    return [...experiences].sort((a, b) => {
      const dateA = a.endDate ? new Date(a.endDate).getTime() : Date.now();
      const dateB = b.endDate ? new Date(b.endDate).getTime() : Date.now();
      return dateB - dateA;
    });
  }, [experiences?.map(e => e.id).join(",")]);

  // Auto-open enrichment panel when arriving from result page with context
  useEffect(() => {
    if (autoOpened || !experiences?.length || !enrichmentContext?.experienceId) return;
    const target = experiences.find(e => e.id === enrichmentContext.experienceId);
    if (target) {
      setEnrichingExpId(target.id);
      setEnrichmentMissing(enrichmentContext.missingKeywords);
      setEnrichmentJobTitle(enrichmentContext.jobTitle);
      setAutoOpened(true);
    }
  }, [experiences, enrichmentContext, autoOpened]);

  if (isLoading) return <div className="h-40 flex items-center justify-center text-muted-foreground"><RefreshCw className="w-6 h-6 animate-spin" /></div>;

  const enrichingExp = experiences?.find(e => e.id === enrichingExpId) || null;

  const handleOpenPanel = (expId: string, bulletId?: string) => {
    setEnrichingExpId(expId);
    setEditBulletId(bulletId || null);
    // Clear job context when opening manually
    setEnrichmentMissing(undefined);
    setEnrichmentJobTitle(undefined);
  };

  return (
    <Card variant="panel" className="flex flex-col gap-6 p-6 md:p-8">
      {/* Contextual banner when arriving from result page */}
      {enrichmentContext?.jobTitle && enrichmentContext?.missingKeywords?.length ? (
        <div className="rounded-2xl border border-warning/30 bg-warning-soft/50 p-4">
          <div className="flex items-start gap-3">
            <Target className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-warning-strong">
                Enrichir pour : {enrichmentContext.jobTitle}
              </p>
              <p className="text-sm text-muted-foreground">
                Ajoute des bullets sur : {enrichmentContext.missingKeywords.join(", ")}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <SectionTitle
        className="items-end"
        title={<span className="flex items-center gap-2"><Briefcase className="size-5 text-primary" /> Expériences</span>}
        description="Structure tes expériences et bullets pour un tailoring plus fiable."
        aside={
          <div className="flex flex-wrap gap-2">
            <CVImportDialog open={importOpen} onOpenChange={setImportOpen} />
            <ExperienceDialog open={editOpen} onOpenChange={setEditOpen} experience={editingExp} onClose={() => setEditingExp(null)} />
          </div>
        }
      />

      {!experiences?.length ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border/70 px-6 py-12 text-center">
          <Mascot variant="thinking" className="mb-4 size-24" />
          <h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Importez votre CV</h3>
          <p className="mb-5 mt-1 max-w-sm text-base text-muted-foreground">Uploadez un PDF ou collez le texte de votre CV pour pré-remplir vos expériences.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => setImportOpen(true)}><Upload /> Importer un CV</Button>
            <Button variant="outline" onClick={() => setEditOpen(true)}><Plus /> Ajouter manuellement</Button>
          </div>
        </div>
      ) : (
        <Accordion type="multiple" className="flex flex-col gap-3">
          {sortedExperiences.map(exp => (
            <ExperienceAccordionItem
              key={exp.id}
              experience={exp}
              onEdit={() => { setEditingExp(exp); setEditOpen(true); }}
              onOpenPanel={(bulletId?: string) => handleOpenPanel(exp.id, bulletId)}
            />
          ))}
        </Accordion>
      )}

      <Sheet open={!!enrichingExp} onOpenChange={(val) => { if (!val) { setEnrichingExpId(null); setEditBulletId(null); setEnrichmentMissing(undefined); setEnrichmentJobTitle(undefined); } }}>
        <SheetContent className="w-full sm:max-w-lg p-0 flex flex-col">
          {enrichingExp && (
            <EnrichmentPanel
              experience={enrichingExp}
              initialBulletId={editBulletId}
              missingKeywords={enrichmentMissing}
              jobTitle={enrichmentJobTitle}
            />
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════
   EXPERIENCE ACCORDION ITEM — read-only, all UI polish
   ══════════════════════════════════════════════════════════════════ */
function ExperienceAccordionItem({ experience, onEdit, onOpenPanel }: {
  experience: Experience; onEdit: () => void; onOpenPanel: (bulletId?: string) => void;
}) {
  const { data: bullets } = useBullets(experience.id);
  const bulletCount = bullets?.length || 0;
  const depth = getDepthInfo(bulletCount);

  function quickCheckBullet(text: string, tags: string[]): string[] {
    const warnings: string[] = [];
    if (text.length < 60) warnings.push("Trop court");
    if (text.length > 200) warnings.push("Trop long");
    if (!/\d+/.test(text)) warnings.push("Pas de chiffre");
    if (!tags || tags.length === 0) warnings.push("Pas de tags");
    return warnings;
  }

  return (
    <div className="group">
    <AccordionItem value={experience.id} className="overflow-hidden rounded-2xl border border-border/60 bg-card/80">
      <div className="flex items-center pr-4">
        <AccordionTrigger className="flex-1 px-5 py-5 hover:no-underline data-[state=open]:border-b data-[state=open]:border-border/50 [&>svg]:hidden">
          <div className="flex w-full items-start gap-3">
            {/* Chevron left */}
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary">
              <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Building className="size-3" /> {experience.company}</span>
                {(experience as any).contractType && <Badge variant="outline">{(experience as any).contractType}</Badge>}
                <span className="opacity-40">|</span>
                <span className="flex items-center gap-1"><Calendar className="size-3" /> {experience.startDate ? format(new Date(experience.startDate), "MMM yyyy") : "N/A"} – {experience.endDate ? format(new Date(experience.endDate), "MMM yyyy") : "Présent"}</span>
              </div>
              <span className="text-base font-semibold text-foreground">{experience.title}</span>
              <div className="mt-0.5 flex items-center gap-2">
                <Badge variant={depth.variant} className="font-semibold">{depth.label}</Badge>
                <div className="flex gap-1.5">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className={cn("size-2 rounded-full", i < depth.dots ? depth.dotClass : "bg-border")} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </AccordionTrigger>
        <div className="ml-auto flex items-center gap-1 pl-3 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Modifier l'expérience">
            <Pencil />
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenPanel()}>
            <Sparkles /> {bulletCount >= 5 ? "Optimiser" : "Enrichir"}
          </Button>
        </div>
      </div>
      <AccordionContent className="p-0">
        <div className="flex flex-col gap-3 p-5">
          {experience.description && (
            <p className="mb-1 whitespace-pre-line text-sm text-muted-foreground">{experience.description}</p>
          )}

          {(!bullets || bullets.length === 0) && (
            <p className="py-4 text-center text-sm text-muted-foreground">Aucun bullet. Clique sur Enrichir pour commencer.</p>
          )}

          {bullets?.map(bullet => {
            const warnings = quickCheckBullet(bullet.text, bullet.tags || []);
            return (
              <div
                key={bullet.id}
                onClick={() => onOpenPanel(bullet.id)}
                className={cn(
                  "cursor-pointer rounded-md border p-4 transition-colors hover:border-primary/30",
                  warnings.length > 0 ? "border-warning/30 bg-warning-soft/30" : "border-border/60 bg-card",
                )}
              >
                {/* Tags */}
                {bullet.tags && bullet.tags.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {bullet.tags.map((tag: string, i: number) => (
                      <Badge key={i} variant="tag">{tag}</Badge>
                    ))}
                  </div>
                )}
                {/* Text */}
                <p className="text-sm leading-relaxed text-foreground">{bullet.text}</p>
                {/* Warnings — separated from tags */}
                {warnings.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/40 pt-2">
                    {warnings.map((w, i) => (
                      <Badge key={i} variant="warning">○ {w}</Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </AccordionContent>
    </AccordionItem>
    </div>
  );
}
/* ══════════════════════════════════════════════════════════════════
   ENRICHMENT PANEL — list / edit / axes — polished UI
   ══════════════════════════════════════════════════════════════════ */
function EnrichmentPanel({ experience, initialBulletId, missingKeywords, jobTitle }: {
  experience: Experience;
  initialBulletId?: string | null;
  missingKeywords?: string[];
  jobTitle?: string;
}) {
  const { data: bullets } = useBullets(experience.id);
  const createBullet = useCreateBullet();
  const updateBullet = useUpdateBullet();
  const deleteBullet = useDeleteBullet();
  const { toast } = useToast();

  const MAX_BULLETS = 5;
  const MIN_CHARS = 60;
  const MAX_CHARS = 200;
  const bulletCount = bullets?.length || 0;
  const remaining = MAX_BULLETS - bulletCount;

  type Step = "loading" | "axes" | "gaps" | "list" | "edit";
  const [step, setStep] = useState<Step>("loading");
  const [axes, setAxes] = useState<string[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [gapsFetched, setGapsFetched] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [newTagText, setNewTagText] = useState("");
  const [editEval, setEditEval] = useState<Record<string, boolean> | null>(null);
  const [editReasons, setEditReasons] = useState<Record<string, string> | null>(null);
  const [editSuggestion, setEditSuggestion] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState<string | null>(null); // question from detect-gaps
  const [processing, setProcessing] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/bullets/tags", { credentials: "include" })
      .then(r => r.json())
      .then((tags: string[]) => setAllTags(tags))
      .catch(() => {});
  }, []);

  function quickCheck(text: string, tags: string[]): string[] {
    const w: string[] = [];
    if (text.length < 60) w.push("Trop court");
    if (text.length > 200) w.push("Trop long");
    if (!/\d+/.test(text)) w.push("Pas de chiffre");
    if (!tags || tags.length === 0) w.push("Pas de tags");
    return w;
  }

  useEffect(() => {
    if (initialBulletId && bullets?.length) {
      const b = bullets.find((x: any) => x.id === initialBulletId);
      if (b) { openEdit(b.id, b.text, b.tags || []); return; }
    }
    // When arriving from result page with job context, show gaps directly
    if (missingKeywords?.length && bulletCount > 0) {
      fetchGaps();
      return;
    }
    if (bulletCount > 0) {
      setStep("list");
    } else {
      fetchAxes();
    }
  }, [experience.id]);

  const fetchAxes = async () => {
    setStep("loading");
    try {
      const res = await fetch(`/api/experiences/${experience.id}/extract-axes`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      });
      const data = await res.json();
      if (data.llmError) {
        toast({ title: "IA indisponible", description: "L'extraction des axes a echoue. Continue manuellement.", variant: "destructive" });
      }
      const suggested = (data.axes || []).map((a: any) => a.text || a).filter(Boolean);
      setAxes(suggested);
      setStep(suggested.length > 0 ? "axes" : "edit");
    } catch { setStep("edit"); }
  };

  const fetchGaps = async () => {
    if (gapsFetched) { setStep("gaps"); return; }
    setStep("loading");
    try {
      const res = await fetch(`/api/experiences/${experience.id}/detect-gaps`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      });
      const data = await res.json();
      if (data.llmError) {
        toast({ title: "IA indisponible", description: "La detection des lacunes a echoue.", variant: "destructive" });
        setStep(bulletCount > 0 ? "list" : "edit");
        return;
      }
      const detected = (data.gaps || []).filter((g: Gap) => g.question);
      setGaps(detected);
      setGapsFetched(true);
      setStep(detected.length > 0 ? "gaps" : bulletCount > 0 ? "list" : "edit");
    } catch {
      setStep(bulletCount > 0 ? "list" : "edit");
    }
  };

  const openEdit = (id: string | null, text: string, tags: string[], prompt?: string) => {
    setEditId(id);
    setEditText(text);
    setEditTags(tags);
    setEditEval(null);
    setEditReasons(null);
    setEditSuggestion(null);
    setEditPrompt(prompt || null);
    setNewTagText("");
    setStep("edit");
    setTimeout(() => textRef.current?.focus(), 100);
  };

  const handleEvaluate = async () => {
    if (!editText.trim()) return;
    setProcessing(true);
    try {
      const res = await fetch(`/api/experiences/${experience.id}/tag-evaluate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editText.trim() }), credentials: "include",
      });
      const data = await res.json();
      if (data.llmError) {
        toast({ title: "IA indisponible", description: "Le tagging automatique a echoue. Tu peux tagger manuellement.", variant: "destructive" });
      }
      setEditTags(data.tags || editTags);
      setEditEval(data.evaluation || null);
      setEditReasons(data.reasons || null);
      setEditSuggestion(data.suggestion || null);
    } catch {} finally { setProcessing(false); }
  };

  const handleSave = async () => {
    if (!editText.trim() || editText.trim().length < MIN_CHARS) return;
    let finalTags = editTags;
    if (finalTags.length === 0) {
      try {
        const res = await fetch(`/api/experiences/${experience.id}/tag-evaluate`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: editText.trim() }), credentials: "include",
        });
        const data = await res.json();
        finalTags = data.tags || ["general"];
      } catch { finalTags = ["general"]; }
    }
    try {
      if (editId) {
        await updateBullet.mutateAsync({ id: editId, experienceId: experience.id, text: editText.trim(), tags: finalTags });
        toast({ title: "Bullet mis a jour" });
      } else {
        await createBullet.mutateAsync({ experienceId: experience.id, text: editText.trim(), tags: finalTags });
        toast({ title: "Bullet enregistre" });
      }
      setStep("list");
    } catch (e: any) {
      if (e.message?.includes("similaire")) {
        toast({ title: "Doublon", description: "Un bullet similaire existe deja." });
      } else {
        toast({ title: "Erreur", description: e.message, variant: "destructive" });
      }
    }
  };

  const handleDelete = async () => {
    if (!editId) return;
    try {
      await deleteBullet.mutateAsync({ id: editId, experienceId: experience.id });
      toast({ title: "Bullet supprime" });
      setStep("list");
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  const charCount = editText.trim().length;
  const charValid = charCount >= MIN_CHARS && charCount <= MAX_CHARS;
  const charColor = charCount === 0 ? "text-muted-foreground" : charValid ? "text-success-strong" : "text-warning-strong";

  const CRITERIA = [
    { key: "clarte", label: "Clarté" },
    { key: "contexte", label: "Contexte" },
    { key: "scope", label: "Scope" },
    { key: "impact", label: "Impact" },
    { key: "completude", label: "Complétude" },
  ];

  const optionCardClass =
    "h-auto w-full justify-start whitespace-normal rounded-2xl border border-border/60 bg-card/80 p-4 text-left text-sm font-normal leading-relaxed text-foreground hover:border-primary/40 hover:bg-primary-soft/30 hover:text-foreground";
  const freeWriteClass =
    "w-full rounded-md border border-dashed border-border hover:border-primary/50 hover:bg-transparent hover:text-primary";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <SheetHeader className="flex flex-col gap-1.5 space-y-0 border-b border-border/60 bg-card/80 p-6 pb-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Building className="size-3.5" /> {experience.company}
          {experience.startDate && (
            <>
              <span className="opacity-40">|</span>
              <Calendar className="size-3.5" />
              {format(new Date(experience.startDate), "MMM yyyy")} – {experience.endDate ? format(new Date(experience.endDate), "MMM yyyy") : "Présent"}
            </>
          )}
        </div>
        <SheetTitle className="text-xl font-semibold tracking-[-0.025em] text-foreground">{experience.title}</SheetTitle>
        <Badge variant="outline" className="w-fit">{bulletCount}/{MAX_BULLETS} bullets</Badge>
      </SheetHeader>

      {/* ── LOADING ── */}
      {step === "loading" && (
        <div className="flex flex-1 items-center justify-center">
          <RefreshCw className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* ── AXES ── */}
      {step === "axes" && (
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">Axes détectés dans ta description</p>
            <p className="text-sm text-muted-foreground">Clique sur un axe pour l'utiliser comme base.</p>
          </div>
          <div className="flex flex-col gap-2.5">
            {axes.map((axis, i) => (
              <Button key={i} variant="ghost" onClick={() => openEdit(null, axis, [])} disabled={remaining <= 0} className={optionCardClass}>
                {axis}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* ── GAPS (detect-gaps questions) ── */}
      {step === "gaps" && (
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <HelpCircle className="size-4 text-warning" />
              <p className="text-sm font-medium text-foreground">Quoi renforcer ?</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {missingKeywords?.length
                ? `Pour "${jobTitle || "ce poste"}" : ces aspects manquent dans tes bullets.`
                : "Réponds à une question pour ajouter un bullet plus concret."}
            </p>
          </div>

          {/* Missing keywords banner from job context (Phase 3) */}
          {missingKeywords && missingKeywords.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-warning/30 bg-warning-soft/40 p-3">
              <span className="mr-1 text-2xs text-muted-foreground">Manquant :</span>
              {missingKeywords.map((kw, i) => (
                <Badge key={i} variant="warning">{kw}</Badge>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {gaps.map((gap) => (
              <Button key={gap.id} variant="ghost" onClick={() => openEdit(null, "", [], gap.question)} disabled={remaining <= 0} className={optionCardClass}>
                <div className="flex items-start gap-3">
                  <Badge variant="secondary" className="mt-0.5 shrink-0 capitalize">{gap.dimension}</Badge>
                  <p className="text-sm leading-relaxed">{gap.question}</p>
                </div>
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* ── LIST ── */}
      {step === "list" && (
        <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-6">
          {bullets?.map((b: any) => {
            const warnings = quickCheck(b.text, b.tags || []);
            return (
              <div key={b.id} onClick={() => openEdit(b.id, b.text, b.tags || [])}
                className={cn(
                  "cursor-pointer rounded-md border p-4 transition-colors hover:border-primary/30",
                  warnings.length > 0 ? "border-warning/30 bg-warning-soft/30" : "border-success/30 bg-success-soft/30",
                )}>
                {/* Tags */}
                {b.tags?.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {b.tags.map((tag: string, i: number) => (
                      <Badge key={i} variant="tag">{tag}</Badge>
                    ))}
                  </div>
                )}
                {/* Text */}
                <p className="text-sm leading-relaxed text-foreground">{b.text}</p>
                {/* Warnings */}
                {warnings.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border/40 pt-2">
                    {warnings.map((w, i) => (
                      <Badge key={i} variant="warning">○ {w}</Badge>
                    ))}
                  </div>
                )}
                {warnings.length === 0 && (
                  <div className="mt-2.5 border-t border-border/40 pt-2">
                    <Badge variant="success">✓ Prêt pour le tailoring</Badge>
                  </div>
                )}
              </div>
            );
          })}
          {!bullets?.length && (
            <p className="py-8 text-center text-sm text-muted-foreground">Aucun bullet.</p>
          )}
        </div>
      )}

      {/* ── EDIT ── */}
      {step === "edit" && (
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
          {/* Prompt from detect-gaps question */}
          {editPrompt && (
            <div className="flex items-start gap-3 rounded-md border border-primary/20 bg-primary-soft/40 p-3">
              <HelpCircle className="mt-0.5 size-4 shrink-0 text-primary" />
              <p className="text-sm leading-relaxed text-primary-strong">{editPrompt}</p>
            </div>
          )}

          {/* Textarea */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <Eyebrow size="sm">Ton bullet</Eyebrow>
              <span className={cn("text-xs font-medium", charColor)}>{charCount}/{MAX_CHARS}</span>
            </div>
            <Textarea
              ref={textRef}
              value={editText}
              onChange={e => { const val = e.target.value.slice(0, MAX_CHARS); setEditText(val); setEditEval(null); }}
              onPaste={e => { e.preventDefault(); const pasted = e.clipboardData.getData("text").slice(0, MAX_CHARS); setEditText(pasted); setEditEval(null); }}
              placeholder="Ex: Conception et déploiement d'un design system pour 3 équipes produit, réduisant le temps de maquettage de 30%"
              className="min-h-[100px] resize-none text-sm"
              maxLength={MAX_CHARS}
            />
            {charCount > 0 && charCount < MIN_CHARS && (
              <p className="mt-2 text-xs text-warning-strong">Minimum {MIN_CHARS} caractères ({MIN_CHARS - charCount} restants)</p>
            )}
          </div>

          {/* Tags */}
          <div>
            <Eyebrow size="sm" className="mb-3">Tags</Eyebrow>
            <div className="flex flex-wrap items-center gap-2">
              {editTags.map((tag, i) => (
                <Badge key={i} variant="tag" className="gap-1 pr-1.5">
                  {tag}
                  <ChipRemoveButton aria-label={`Retirer le tag ${tag}`} onClick={() => setEditTags(prev => prev.filter((_, j) => j !== i))} />
                </Badge>
              ))}
              <Input
                inputSize="sm"
                list="all-tags-list"
                type="text"
                value={newTagText}
                onChange={e => setNewTagText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && newTagText.trim()) {
                    e.preventDefault();
                    setEditTags(prev => [...prev, newTagText.trim()]);
                    setNewTagText("");
                  }
                }}
                placeholder="+ ajouter un tag"
                className="w-auto min-w-[120px] flex-1"
              />
              <datalist id="all-tags-list">
                {allTags.filter(t => !editTags.includes(t)).map(tag => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Evaluation */}
          {editEval && (
            <div>
              <Eyebrow size="sm" className="mb-3">Évaluation</Eyebrow>
              <div className="mb-3 flex flex-wrap gap-2">
                {CRITERIA.map(({ key, label }) => (
                  <Badge key={key} variant={editEval[key] ? "success" : "warning"}>
                    {editEval[key] ? "✓" : "○"} {label}
                  </Badge>
                ))}
              </div>
              {CRITERIA.filter(c => editEval[c.key] === false && editReasons?.[c.key]).map(c => (
                <div key={c.key} className="mb-2 rounded-md bg-warning-soft/60 p-3 text-xs text-warning-strong">
                  <span className="font-medium">{c.label} :</span> {editReasons?.[c.key]}
                </div>
              ))}
            </div>
          )}

          {editSuggestion && (
            <div className="rounded-md bg-warning-soft/60 p-3 text-xs text-warning-strong">
              <span className="font-medium">Suggestion :</span> {editSuggestion}
            </div>
          )}
        </div>
      )}

      {/* ── BOTTOM BAR ── */}
      <div className="flex shrink-0 flex-col gap-2.5 border-t border-border/60 bg-surface p-5">

        {step === "axes" && (
          <>
            <Button variant="ghost" onClick={() => openEdit(null, "", [])} className={freeWriteClass}>
              + Écrire un bullet librement
            </Button>
            {bulletCount > 0 && (
              <Button variant="outline" onClick={fetchGaps} className="w-full">
                <HelpCircle /> Quoi renforcer ?
              </Button>
            )}
          </>
        )}

        {step === "gaps" && (
          <>
            <Button variant="ghost" onClick={() => openEdit(null, "", [])} className={freeWriteClass}>
              + Écrire un bullet librement
            </Button>
            <Button variant="outline" onClick={() => setStep(bulletCount > 0 ? "list" : axes.length > 0 ? "axes" : "edit")} className="w-full">
              Retour
            </Button>
          </>
        )}

        {step === "list" && remaining > 0 && (
          <Button onClick={() => openEdit(null, "", [])} className="w-full">
            <Plus /> Ajouter un bullet ({remaining} restant{remaining > 1 ? "s" : ""})
          </Button>
        )}
        {step === "list" && bulletCount > 0 && (
          <Button variant="outline" onClick={fetchGaps} className="w-full">
            <HelpCircle /> Quoi renforcer ?
          </Button>
        )}
        {step === "list" && remaining > 0 && axes.length > bulletCount && (
          <Button variant="outline" onClick={() => setStep("axes")} className="w-full">
            <Sparkles /> Voir les axes suggérés
          </Button>
        )}

        {step === "edit" && (
          <div className="flex flex-col gap-2.5">
            {!editEval && !processing && (
              <Button onClick={handleEvaluate} disabled={charCount < MIN_CHARS} variant="outline" className="w-full">
                <Sparkles /> Tagger + Évaluer
              </Button>
            )}
            {processing && (
              <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" /> Analyse...
              </div>
            )}
            <Button onClick={handleSave} disabled={!charValid || createBullet.isPending} className="w-full">
              <Check /> {editId ? "Enregistrer" : "Ajouter"}
            </Button>
            <div className="flex gap-2">
              {editEval && !processing && (
                <Button variant="outline" size="icon" onClick={handleEvaluate} title="Ré-évaluer" aria-label="Ré-évaluer">
                  <RefreshCw />
                </Button>
              )}
              <Button variant="outline" onClick={() => setStep(bulletCount > 0 ? "list" : gaps.length > 0 ? "gaps" : axes.length > 0 ? "axes" : "list")} className="flex-1">
                Retour
              </Button>
            </div>
            {editId && (
              <Button variant="link" onClick={handleDelete} className="w-full py-1.5 text-xs text-destructive">
                Supprimer ce bullet
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
/* ══════════════════════════════════════════════════════════════════
   EXPERIENCE DIALOG — fixed pre-filling
   ══════════════════════════════════════════════════════════════════ */
function ExperienceDialog({ open, onOpenChange, experience, onClose }: any) {
  const createExp = useCreateExperience();
  const updateExp = useUpdateExperience();
  const deleteExp = useDeleteExperience();
  const { toast } = useToast();

  const [formData, setFormData] = useState({ title: "", company: "", contractType: "", startDate: "", endDate: "", description: "" });
  const [isCurrent, setIsCurrent] = useState(false);

  useEffect(() => {
    if (experience && open) {
      setFormData({
        title: experience.title || "",
        company: experience.company || "",
        contractType: experience.contractType || "",
        startDate: experience.startDate || "",
        endDate: experience.endDate || "",
        description: experience.description || "",
      });
      setIsCurrent(!experience.endDate);
    } else if (open && !experience) {
      setFormData({ title: "", company: "", contractType: "", startDate: "", endDate: "", description: "" });
      setIsCurrent(false);
    }
  }, [open, experience]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = { ...formData, endDate: isCurrent ? null : formData.endDate || null };
      if (experience) {
        await updateExp.mutateAsync({ id: experience.id, ...data });
        toast({ title: "Experience mise a jour" });
      } else {
        await createExp.mutateAsync(data);
        toast({ title: "Experience ajoutee" });
      }
      onOpenChange(false);
      onClose();
    } catch (err) {
      toast({ title: "Erreur", description: (err as Error).message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!confirm("Supprimer cette experience ?")) return;
    try {
      await deleteExp.mutateAsync(experience.id);
      toast({ title: "Experience supprimee" });
      onOpenChange(false);
      onClose();
    } catch (err) {
      toast({ title: "Erreur", description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => { onOpenChange(val); if (!val) onClose(); }}>
      <DialogTrigger asChild>
        {!experience && <Button variant="outline"><Plus /> Ajouter une expérience</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader><DialogTitle>{experience ? "Modifier" : "Ajouter une expérience"}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2"><Label>Titre</Label><Input inputSize="sm" required value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="Product Designer" /></div>
            <div className="flex flex-col gap-2"><Label>Entreprise</Label><Input inputSize="sm" required value={formData.company} onChange={e => setFormData({ ...formData, company: e.target.value })} placeholder="Accor" /></div>
            <div className="flex flex-col gap-2"><Label>Date début</Label><Input inputSize="sm" type="date" value={formData.startDate} onChange={e => setFormData({ ...formData, startDate: e.target.value })} /></div>
            <div className="flex flex-col gap-2">
              <Label>Date fin</Label>
              <Input inputSize="sm" type="date" value={isCurrent ? "" : formData.endDate} onChange={e => setFormData({ ...formData, endDate: e.target.value })} disabled={isCurrent} className={isCurrent ? "opacity-40" : ""} />
              <label className="mt-1 flex cursor-pointer items-center gap-2">
                <Switch checked={isCurrent} onCheckedChange={setIsCurrent} />
                <span className="text-xs text-muted-foreground">Poste actuel</span>
              </label>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Type de contrat</Label>
            <div className="flex flex-wrap gap-2">
              {["CDI", "Freelance", "CDD", "Stage", "Alternance"].map(ct => (
                <ChoiceChip key={ct} selected={formData.contractType === ct} onClick={() => setFormData({ ...formData, contractType: formData.contractType === ct ? "" : ct })}>
                  {ct}
                </ChoiceChip>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2"><Label>Description</Label><Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Description du rôle..." className="h-24" /></div>
          <DialogFooter className="flex justify-between pt-4 sm:justify-between">
            {experience ? <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleteExp.isPending}>Supprimer</Button> : <div />}
            <Button type="submit" disabled={createExp.isPending || updateExp.isPending}>{experience ? "Enregistrer" : "Créer"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SKILLS SECTION
   ══════════════════════════════════════════════════════════════════ */
function SkillsSection() {
  const { data: skills, isLoading } = useSkills();
  const createSkill = useCreateSkill();
  const deleteSkill = useDeleteSkill();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [proposed, setProposed] = useState<Array<{name: string; category: string; accepted: boolean}>>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCategory, setAddCategory] = useState("Techniques");

  const CATEGORIES = ["Outils", "Methodologies", "Soft Skills", "Domaines", "Techniques"];
  const CATEGORY_ICONS: Record<string, string> = {
    "Outils": "wrench",
    "Methodologies": "compass",
    "Soft Skills": "users",
    "Domaines": "globe",
    "Techniques": "code",
  };

  const grouped = CATEGORIES.reduce((acc, cat) => {
    const catSkills = (skills || []).filter(s => (s.category || "Techniques") === cat);
    if (catSkills.length > 0) acc[cat] = catSkills;
    return acc;
  }, {} as Record<string, typeof skills>);

  // Uncategorized
  const uncategorized = (skills || []).filter(s => !s.category || !CATEGORIES.includes(s.category));
  if (uncategorized.length > 0) grouped["Autres"] = uncategorized;

  const handleExtract = async () => {
    setExtracting(true);
    try {
      const res = await fetch("/api/skills/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      if (!data.skills?.length) {
        toast({ title: "Aucune nouvelle competence detectee" });
        setExtracting(false);
        return;
      }
      setProposed(data.skills.map((s: any) => ({ ...s, accepted: true })));
      setReviewOpen(true);
    } catch (err) {
      toast({ title: "Erreur", description: (err as Error).message, variant: "destructive" });
    } finally {
      setExtracting(false);
    }
  };

  const handleSaveProposed = async () => {
    const toSave = proposed.filter(s => s.accepted);
    let saved = 0;
    for (const s of toSave) {
      try {
        await createSkill.mutateAsync({ name: s.name, category: s.category } as any);
        saved++;
      } catch { /* skip duplicates */ }
    }
    toast({ title: `${saved} competence${saved > 1 ? "s" : ""} ajoutee${saved > 1 ? "s" : ""}` });
    setReviewOpen(false);
    setProposed([]);
  };

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim()) return;
    try {
      await createSkill.mutateAsync({ name: addName.trim(), category: addCategory } as any);
      setAddName("");
      setAddOpen(false);
      toast({ title: "Competence ajoutee" });
    } catch (err) {
      toast({ title: "Erreur", description: (err as Error).message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try { await deleteSkill.mutateAsync(id); }
    catch (err) { toast({ title: "Erreur", description: (err as Error).message, variant: "destructive" }); }
  };

  const totalSkills = (skills || []).length;
  const atLimit = totalSkills >= 15;

  if (isLoading) return <div className="h-40 flex items-center justify-center text-muted-foreground"><RefreshCw className="w-6 h-6 animate-spin" /></div>;

  return (
    <Card variant="panel" className="flex flex-col gap-6 p-6 md:p-8">
      <SectionTitle
        className="items-end"
        title={<span className="flex items-center gap-2"><Zap className="size-5 text-primary" /> Compétences</span>}
        description="Garde uniquement les compétences utiles pour tes candidatures cibles."
        aside={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleExtract} disabled={extracting || atLimit}>
              {extracting ? <RefreshCw className="animate-spin" /> : <Sparkles />}
              {atLimit ? "Limite atteinte" : extracting ? "Analyse..." : "Extraire auto"}
            </Button>
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={atLimit}><Plus /> Ajouter</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[400px]">
                <DialogHeader><DialogTitle>Ajouter une compétence</DialogTitle></DialogHeader>
                <form onSubmit={handleAddManual} className="flex flex-col gap-4 py-4">
                  <div className="flex flex-col gap-2">
                    <Label>Nom</Label>
                    <Input inputSize="sm" required value={addName} onChange={e => setAddName(e.target.value)} placeholder="Figma, User Testing..." />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Catégorie</Label>
                    <div className="flex flex-wrap gap-2">
                      {CATEGORIES.map(cat => (
                        <ChoiceChip key={cat} selected={addCategory === cat} onClick={() => setAddCategory(cat)}>
                          {cat}
                        </ChoiceChip>
                      ))}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={createSkill.isPending}>Enregistrer</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* Skills grouped by category — 2 columns */}
      {Object.keys(grouped).length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center text-muted-foreground">
          <Mascot variant="thinking" className="mb-4 size-24" />
          <p className="text-sm">Aucune compétence.</p>
          <p className="mt-1 text-sm">Cliquez "Extraire auto" pour détecter vos compétences.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
          {Object.entries(grouped).map(([category, catSkills]) => (
            <div key={category}>
              <Eyebrow size="sm" className="mb-2">{category}</Eyebrow>
              <div className="flex flex-wrap gap-2">
                {catSkills!.map(skill => (
                  <Badge key={skill.id} variant="tag" className="group gap-1 pr-1.5 text-sm">
                    {skill.name}
                    <ChipRemoveButton
                      aria-label={`Supprimer ${skill.name}`}
                      onClick={() => handleDelete(skill.id)}
                      className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    />
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Review Dialog for extracted skills */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" />
              Compétences détectées
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Décochez pour exclure. Les compétences décochées ne seront <strong>plus jamais reproposées</strong>.</p>
          <div className="flex flex-col gap-4 py-4">
            {CATEGORIES.map(cat => {
              const catItems = proposed.filter(s => s.category === cat);
              if (!catItems.length) return null;
              return (
                <div key={cat}>
                  <Eyebrow size="sm" className="mb-2">{cat}</Eyebrow>
                  <div className="flex flex-wrap gap-2">
                    {catItems.map((skill, idx) => {
                      const globalIdx = proposed.findIndex(s => s.name === skill.name);
                      return (
                        <ChoiceChip
                          key={idx}
                          selected={skill.accepted}
                          onClick={() => {
                            setProposed(prev => prev.map((s, i) => i === globalIdx ? { ...s, accepted: !s.accepted } : s));
                          }}
                          className={cn(!skill.accepted && "text-muted-foreground line-through opacity-50")}
                        >
                          {skill.accepted ? <Check /> : <X />}
                          {skill.name}
                        </ChoiceChip>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Annuler</Button>
            <Button onClick={handleSaveProposed} disabled={createSkill.isPending || proposed.filter(s => s.accepted).length === 0}>
              {createSkill.isPending ? <RefreshCw className="animate-spin" /> : null}
              Ajouter {proposed.filter(s => s.accepted).length} compétence{proposed.filter(s => s.accepted).length > 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SkillDialog({ open, onOpenChange, skill, onClose }: any) {
  // Kept for backward compat but no longer used as primary
  return null;
}

/* ══════════════════════════════════════════════════════════════════
   CV IMPORT DIALOG
   ══════════════════════════════════════════════════════════════════ */
interface ParsedExp { title: string; company: string; startDate?: string; endDate?: string | null; description?: string; bullets?: string[]; selected?: boolean; }

function CVImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (val: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"input" | "loading" | "review">("input");
  const [rawText, setRawText] = useState("");
  const [parsedExps, setParsedExps] = useState<ParsedExp[]>([]);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => { setStep("input"); setRawText(""); setParsedExps([]); setSaving(false); };

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) { toast({ title: "Format non supporte", description: "PDF uniquement.", variant: "destructive" }); return; }
    setStep("loading");
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(new Error("Lecture impossible"));
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/import/cv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileBase64: base64 }), credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      if (!data.experiences?.length) { toast({ title: "Aucune experience trouvee", variant: "destructive" }); setStep("input"); return; }
      setParsedExps(data.experiences.map((e: any) => ({ ...e, selected: true }))); setStep("review");
    } catch (err) { toast({ title: "Erreur", description: (err as Error).message, variant: "destructive" }); setStep("input"); }
  };

  const handleTextSubmit = async () => {
    if (!rawText.trim()) return;
    setStep("loading");
    try {
      const res = await fetch("/api/import/cv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: rawText }), credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      if (!data.experiences?.length) { toast({ title: "Aucune experience trouvee", variant: "destructive" }); setStep("input"); return; }
      setParsedExps(data.experiences.map((e: any) => ({ ...e, selected: true }))); setStep("review");
    } catch (err) { toast({ title: "Erreur", description: (err as Error).message, variant: "destructive" }); setStep("input"); }
  };

  const toggleExp = (idx: number) => { setParsedExps(prev => prev.map((e, i) => i === idx ? { ...e, selected: !e.selected } : e)); };

  const handleSaveAll = async () => {
    const toSave = parsedExps.filter(e => e.selected);
    if (!toSave.length) return;
    setSaving(true);
    try {
      const res = await fetch("/api/import/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ experiences: toSave }), credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      toast({ title: `${data.created} experience${data.created > 1 ? "s" : ""} importee${data.created > 1 ? "s" : ""}` });
      queryClient.invalidateQueries({ queryKey: ["/api/experiences"] });
      onOpenChange(false); reset();
    } catch (err) { toast({ title: "Erreur", description: (err as Error).message, variant: "destructive" }); setSaving(false); }
  };

  const selectedCount = parsedExps.filter(e => e.selected).length;

  return (
    <Dialog open={open} onOpenChange={(val) => { onOpenChange(val); if (!val) reset(); }}>
      <DialogTrigger asChild><Button><Upload /> Importer un CV</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[650px]">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="size-5 text-primary" /> Importer votre CV</DialogTitle></DialogHeader>

        {step === "input" && (
          <div className="flex flex-col gap-4 py-4">
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-colors",
                dragOver ? "border-primary bg-primary-soft/40" : "border-border hover:border-primary/50",
              )}
            >
              <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
              <Upload className="mx-auto mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">Déposez votre CV ici ou cliquez</p>
              <p className="mt-1 text-xs text-muted-foreground">PDF uniquement</p>
            </div>
            <div className="flex items-center gap-3"><div className="h-px flex-1 bg-border" /><span className="text-xs text-muted-foreground">ou collez le texte</span><div className="h-px flex-1 bg-border" /></div>
            <Textarea value={rawText} onChange={e => setRawText(e.target.value)} placeholder="Collez le contenu de votre CV ou profil LinkedIn ici..." className="h-32 text-sm" />
            <DialogFooter><Button onClick={handleTextSubmit} disabled={!rawText.trim()}>Analyser</Button></DialogFooter>
          </div>
        )}

        {step === "loading" && (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <RefreshCw className="size-8 animate-spin text-primary" />
            <p className="font-medium text-foreground">Analyse en cours...</p>
          </div>
        )}

        {step === "review" && (
          <div className="flex flex-col gap-4 py-4">
            <p className="text-sm text-muted-foreground">{parsedExps.length} expérience{parsedExps.length > 1 ? "s" : ""} trouvée{parsedExps.length > 1 ? "s" : ""}. Décochez celles que vous ne voulez pas.</p>
            <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto pr-1">
              {parsedExps.map((exp, idx) => (
                <div key={idx} onClick={() => toggleExp(idx)} className={cn(
                  "cursor-pointer rounded-2xl border p-4 transition-colors",
                  exp.selected ? "border-primary/50 bg-primary-soft/30" : "border-border opacity-50",
                )}>
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-xs border-2",
                      exp.selected ? "border-primary bg-primary" : "border-border",
                    )}>
                      {exp.selected && <Check className="size-3 text-primary-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-foreground">{exp.title}</div>
                      <div className="text-sm text-muted-foreground">{exp.company}</div>
                      {exp.startDate && <div className="mt-1 text-xs text-muted-foreground">{exp.startDate} - {exp.endDate || "Présent"}</div>}
                      {exp.bullets && exp.bullets.length > 0 && (
                        <div className="mt-2 flex flex-col gap-1">{exp.bullets.map((b, i) => <div key={i} className="border-l-2 border-border pl-3 text-xs text-muted-foreground">{b}</div>)}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter className="flex gap-2 pt-4">
              <Button variant="outline" onClick={() => { setStep("input"); setParsedExps([]); }}>Retour</Button>
              <Button onClick={handleSaveAll} disabled={saving || selectedCount === 0}>
                {saving ? <><RefreshCw className="animate-spin" /> Import...</> : `Importer ${selectedCount} expérience${selectedCount > 1 ? "s" : ""}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════
   FORMATIONS SECTION
   ══════════════════════════════════════════════════════════════════ */
function FormationsSection() {
  const [formations, setFormations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [school, setSchool] = useState("");
  const [degree, setDegree] = useState("");
  const [year, setYear] = useState("");
  const { toast } = useToast();

  const fetchFormations = async () => {
    try {
      const res = await fetch("/api/formations", { credentials: "include" });
      if (res.ok) setFormations(await res.json());
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchFormations(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!school.trim() || !degree.trim()) return;
    try {
      await fetch("/api/formations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ school: school.trim(), degree: degree.trim(), year: year.trim() || null }),
        credentials: "include",
      });
      setSchool(""); setDegree(""); setYear(""); setAddOpen(false);
      fetchFormations();
      toast({ title: "Formation ajoutee" });
    } catch (err) {
      toast({ title: "Erreur", description: (err as Error).message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/formations/${id}`, { method: "DELETE", credentials: "include" });
    fetchFormations();
  };

  if (loading) return null;

  return (
    <Card variant="panel" className="flex flex-col gap-5 p-6 md:p-8">
      <SectionTitle
        className="items-center"
        title={<span className="flex items-center gap-2"><GraduationCap className="size-5 text-primary" /> Formation</span>}
        aside={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm"><Plus /> Ajouter</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[400px]">
              <DialogHeader><DialogTitle>Ajouter une formation</DialogTitle></DialogHeader>
              <form onSubmit={handleAdd} className="flex flex-col gap-4 py-4">
                <div className="flex flex-col gap-2"><Label>École</Label><Input inputSize="sm" required value={school} onChange={e => setSchool(e.target.value)} placeholder="Web School Factory" /></div>
                <div className="flex flex-col gap-2"><Label>Diplôme</Label><Input inputSize="sm" required value={degree} onChange={e => setDegree(e.target.value)} placeholder="Master en Digital Design" /></div>
                <div className="flex flex-col gap-2"><Label>Année</Label><Input inputSize="sm" value={year} onChange={e => setYear(e.target.value)} placeholder="2019" /></div>
                <DialogFooter><Button type="submit">Ajouter</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {formations.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune formation ajoutée.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {formations.map((f: any) => (
            <Card key={f.id} variant="inset" className="group flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{f.degree}</p>
                <p className="text-xs text-muted-foreground">{f.school}{f.year ? ` · ${f.year}` : ""}</p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Supprimer la formation"
                onClick={() => handleDelete(f.id)}
                className="shrink-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
              >
                <X />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════
   LANGUAGES SECTION
   ══════════════════════════════════════════════════════════════════ */
function LanguagesSection() {
  const [langs, setLangs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [level, setLevel] = useState("");
  const { toast } = useToast();

  const LANG_SUGGESTIONS = ["Francais", "Anglais", "Espagnol", "Allemand", "Italien", "Portugais", "Chinois", "Arabe", "Japonais"];
  const LEVELS = ["Langue maternelle", "Courant (C1)", "Professionnel (B2)", "Intermediaire (B1)", "Scolaire", "Notions"];

  const fetchLangs = async () => {
    try {
      const res = await fetch("/api/languages", { credentials: "include" });
      if (res.ok) setLangs(await res.json());
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchLangs(); }, []);

  const handleAdd = async () => {
    if (!name.trim()) return;
    try {
      await fetch("/api/languages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), level: level || null }),
        credentials: "include",
      });
      setName(""); setLevel(""); setAddOpen(false);
      fetchLangs();
      toast({ title: "Langue ajoutee" });
    } catch (err) {
      toast({ title: "Erreur", description: (err as Error).message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/languages/${id}`, { method: "DELETE", credentials: "include" });
    fetchLangs();
  };

  if (loading) return null;

  return (
    <Card variant="panel" className="flex flex-col gap-5 p-6 md:p-8">
      <SectionTitle
        className="items-center"
        title={<span className="flex items-center gap-2"><Globe className="size-5 text-primary" /> Langues</span>}
        aside={
          <Dialog open={addOpen} onOpenChange={(val) => { setAddOpen(val); if (!val) { setName(""); setLevel(""); } }}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm"><Plus /> Ajouter</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[420px]">
              <DialogHeader><DialogTitle>Ajouter une langue</DialogTitle></DialogHeader>
              <div className="flex flex-col gap-5 py-4">
                <div className="flex flex-col gap-2">
                  <Label>Langue</Label>
                  <div className="flex flex-wrap gap-2">
                    {LANG_SUGGESTIONS.map(l => (
                      <ChoiceChip key={l} selected={name === l} onClick={() => setName(name === l ? "" : l)}>
                        {l}
                      </ChoiceChip>
                    ))}
                  </div>
                  <Input inputSize="sm" value={name} onChange={e => setName(e.target.value)} placeholder="Autre langue..." className="mt-2" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Niveau</Label>
                  <div className="flex flex-wrap gap-2">
                    {LEVELS.map(l => (
                      <ChoiceChip key={l} selected={level === l} onClick={() => setLevel(level === l ? "" : l)}>
                        {l}
                      </ChoiceChip>
                    ))}
                  </div>
                </div>
                <DialogFooter><Button onClick={handleAdd} disabled={!name.trim()}>Ajouter</Button></DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      {langs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune langue ajoutée.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {langs.map((l: any) => (
            <Card key={l.id} variant="inset" className="group flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-sm font-medium text-foreground">{l.name}</span>
                {l.level && <span className="text-xs text-muted-foreground">{l.level}</span>}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Supprimer la langue"
                onClick={() => handleDelete(l.id)}
                className="shrink-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
              >
                <X />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </Card>
  );
}

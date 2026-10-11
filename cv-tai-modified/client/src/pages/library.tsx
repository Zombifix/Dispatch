import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { format } from "date-fns";
import { Layout } from "@/components/layout";
import { useExperiences, useCreateExperience, useUpdateExperience, useDeleteExperience } from "@/hooks/use-experiences";
import { useBullets, useCreateBullet, useUpdateBullet, useDeleteBullet } from "@/hooks/use-bullets";
import { useSkills, useCreateSkill, useDeleteSkill } from "@/hooks/use-skills";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Plus, Building, Calendar, Pencil, RefreshCw, Briefcase, Zap, Upload, Sparkles, Check, X, GraduationCap, Globe, ChevronDown, HelpCircle, Target } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import type { Experience } from "@shared/schema";

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

function getDepthInfo(bulletCount: number) {
  if (bulletCount === 0) return { label: "Vide", color: "#C45050", bg: "#FEF0EF", dots: 0 };
  if (bulletCount <= 2) return { label: "Ebauche", color: "#B8941F", bg: "#FEF9EC", dots: 1 };
  if (bulletCount <= 4) return { label: "Structure", color: "#4D8A5E", bg: "#EEF5EF", dots: 3 };
  return { label: "Complet", color: "#2D7A3D", bg: "#E0F0E0", dots: 5 };
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
      <div className="flex flex-col gap-8 max-w-4xl">
        <div className="space-y-2 mt-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Super CV</p>
          <div className="space-y-1">
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Bibliotheque source</h1>
            <p className="text-sm text-muted-foreground">La base qui alimente tous tes tailorings.</p>
          </div>
        </div>

        {/* ── PROFILE HEADER ── */}
        <Card className="border border-border/70 shadow-sm">
          <CardContent className="p-5">
          {editingProfile ? (
            <div className="space-y-3 animate-in fade-in-50">
              <Input value={profileDraft.name} onChange={e => setProfileDraft({ ...profileDraft, name: e.target.value })}
                placeholder="Prenom Nom" className="text-2xl font-bold border-0 p-0 h-auto focus-visible:ring-0 bg-transparent" />
              <Input value={profileDraft.title} onChange={e => setProfileDraft({ ...profileDraft, title: e.target.value })}
                placeholder="Senior Product Designer" className="text-base text-muted-foreground border-0 p-0 h-auto focus-visible:ring-0 bg-transparent" />
              <Input value={profileDraft.summary} onChange={e => setProfileDraft({ ...profileDraft, summary: e.target.value })}
                placeholder="Une phrase qui te resume (optionnel)" className="text-sm text-muted-foreground border-0 p-0 h-auto focus-visible:ring-0 bg-transparent" />
              <Button size="sm" onClick={handleSaveProfile}>Valider</Button>
            </div>
          ) : (
            <div className="group">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">{profile.name || "Votre nom"}</h2>
                  <p className="text-base text-muted-foreground mt-0.5">{profile.title || "Votre poste"}</p>
                  {profile.summary && <p className="text-sm text-muted-foreground/70 mt-1">{profile.summary}</p>}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setEditingProfile(true)}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Modifier
                </Button>
              </div>
            </div>
          )}
          </CardContent>
        </Card>

        {/* ── EXPERIENCES ── */}
        <ExperiencesSection enrichmentContext={enrichmentContext} />

        {/* ── SKILLS ── */}
        <SkillsSection />

        {/* ── FORMATIONS + LANGUAGES — side by side ── */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <FormationsSection />
          <LanguagesSection />
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
    <div className="space-y-6">
      {/* Contextual banner when arriving from result page */}
      {enrichmentContext?.jobTitle && enrichmentContext?.missingKeywords?.length ? (
        <div className="rounded-lg border border-amber-200/60 dark:border-amber-800/40 bg-amber-50/40 dark:bg-amber-950/20 p-4">
          <div className="flex items-start gap-3">
            <Target className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Enrichir pour : {enrichmentContext.jobTitle}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Ajoute des bullets sur : {enrichmentContext.missingKeywords.join(", ")}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex justify-between items-end gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-primary" /> Experiences
          </h2>
          <p className="text-sm text-muted-foreground">Structure tes experiences et bullets pour un tailoring plus fiable.</p>
        </div>
        <div className="flex gap-2">
          <CVImportDialog open={importOpen} onOpenChange={setImportOpen} />
          <ExperienceDialog open={editOpen} onOpenChange={setEditOpen} experience={editingExp} onClose={() => setEditingExp(null)} />
        </div>
      </div>

      {!experiences?.length ? (
        <Card className="border-dashed border-2 bg-transparent shadow-none">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-4">
              <Upload className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-lg">Importez votre CV</h3>
            <p className="text-muted-foreground mt-1 mb-4 max-w-sm">Uploadez un PDF ou collez le texte de votre CV pour pre-remplir vos experiences.</p>
            <div className="flex gap-2">
              <Button onClick={() => setImportOpen(true)}><Upload className="w-4 h-4 mr-2" /> Importer un CV</Button>
              <Button variant="outline" onClick={() => setEditOpen(true)}><Plus className="w-4 h-4 mr-2" /> Ajouter manuellement</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" className="space-y-3">
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
    </div>
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
    <AccordionItem value={experience.id} className="bg-card border border-border/70 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center pr-4">
        <AccordionTrigger className="flex-1 hover:no-underline py-5 px-5 data-[state=open]:border-b data-[state=open]:border-border/50 [&>svg]:hidden">
          <div className="flex items-start gap-3 w-full">
            {/* Chevron left */}
            <div className="w-7 h-7 rounded-md bg-muted/50 flex items-center justify-center shrink-0 mt-0.5">
              <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200" />
            </div>
            <div className="flex flex-col items-start text-left gap-1 flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><Building className="w-3 h-3" /> {experience.company}</span>
                {(experience as any).contractType && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{(experience as any).contractType}</Badge>}
                <span className="opacity-40">|</span>
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {experience.startDate ? format(new Date(experience.startDate), "MMM yyyy") : "N/A"} – {experience.endDate ? format(new Date(experience.endDate), "MMM yyyy") : "Present"}</span>
              </div>
              <span className="font-bold text-base">{experience.title}</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md" style={{ background: depth.bg, color: depth.color }}>{depth.label}</span>
                <div className="flex gap-1.5">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="w-2 h-2 rounded-full" style={{ background: i < depth.dots ? depth.color : "#e8e5de" }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </AccordionTrigger>
        <div className="flex items-center gap-1 ml-auto pl-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={onEdit}>
            <Pencil className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => onOpenPanel()}>
            <Sparkles className="w-3.5 h-3.5" /> {bulletCount >= 5 ? "Optimiser" : "Enrichir"}
          </Button>
        </div>
      </div>
      <AccordionContent className="p-0">
        <div className="p-5 space-y-3">
          {experience.description && (
            <p className="text-sm text-foreground/70 whitespace-pre-line mb-4">{experience.description}</p>
          )}

          {(!bullets || bullets.length === 0) && (
            <p className="text-sm text-muted-foreground text-center py-4">Aucun bullet. Clique sur Enrichir pour commencer.</p>
          )}

          {bullets?.map(bullet => {
            const warnings = quickCheckBullet(bullet.text, bullet.tags || []);
            return (
              <div
                key={bullet.id}
                onClick={() => onOpenPanel(bullet.id)}
                className={`rounded-lg p-4 border transition-colors cursor-pointer hover:border-primary/30 ${warnings.length > 0 ? "border-amber-200 dark:border-amber-800/30 bg-amber-50/20 dark:bg-amber-950/10" : "border-border/40 bg-background/70"}`}
              >
                {/* Tags */}
                {bullet.tags && bullet.tags.length > 0 && (
                  <div className="flex gap-1.5 mb-2 flex-wrap">
                    {bullet.tags.map((tag: string, i: number) => (
                      <span key={i} className="text-[13px] px-3 py-0.5 bg-secondary text-secondary-foreground rounded-md">{tag}</span>
                    ))}
                  </div>
                )}
                {/* Text */}
                <p className="text-sm text-foreground/90 leading-relaxed">{bullet.text}</p>
                {/* Warnings — separated from tags */}
                {warnings.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mt-2 pt-2 border-t border-border/20">
                    {warnings.map((w, i) => (
                      <span key={i} className="text-xs px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">○ {w}</span>
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
  const charColor = charCount === 0 ? "text-muted-foreground" : charValid ? "text-green-600" : "text-amber-600";

  const CRITERIA = [
    { key: "clarte", label: "Clarte" },
    { key: "contexte", label: "Contexte" },
    { key: "scope", label: "Scope" },
    { key: "impact", label: "Impact" },
    { key: "completude", label: "Completude" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <SheetHeader className="p-6 pb-5 border-b border-border/50 bg-background/80 space-y-1.5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Building className="w-3.5 h-3.5" /> {experience.company}
          {experience.startDate && (
            <>
              <span className="opacity-40">|</span>
              <Calendar className="w-3.5 h-3.5" />
              {format(new Date(experience.startDate), "MMM yyyy")} – {experience.endDate ? format(new Date(experience.endDate), "MMM yyyy") : "Present"}
            </>
          )}
        </div>
        <SheetTitle className="text-lg font-semibold tracking-tight">{experience.title}</SheetTitle>
        <Badge variant="outline" className="text-xs w-fit">{bulletCount}/{MAX_BULLETS} bullets</Badge>
      </SheetHeader>

      {/* ── LOADING ── */}
      {step === "loading" && (
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* ── AXES ── */}
      {step === "axes" && (
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <p className="text-sm font-medium">Axes detectes dans ta description</p>
            <p className="text-xs text-muted-foreground mt-1">Clique sur un axe pour l'utiliser comme base.</p>
          </div>
          <div className="space-y-2.5">
            {axes.map((axis, i) => (
              <button key={i} onClick={() => openEdit(null, axis, [])} disabled={remaining <= 0}
                className="w-full text-left text-sm p-4 rounded-lg border border-border bg-background hover:border-primary/50 hover:bg-primary/5 transition-all disabled:opacity-50 leading-relaxed">
                {axis}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── GAPS (detect-gaps questions) ── */}
      {step === "gaps" && (
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <div className="flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <p className="text-sm font-medium">Quoi renforcer ?</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {missingKeywords?.length
                ? `Pour "${jobTitle || "ce poste"}" : ces aspects manquent dans tes bullets.`
                : "Reponds a une question pour ajouter un bullet plus concret."}
            </p>
          </div>

          {/* Missing keywords banner from job context (Phase 3) */}
          {missingKeywords && missingKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5 p-3 rounded-lg border border-amber-200/60 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-950/10">
              <span className="text-[11px] text-muted-foreground mr-1">Manquant :</span>
              {missingKeywords.map((kw, i) => (
                <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 font-medium">{kw}</span>
              ))}
            </div>
          )}

          <div className="space-y-2.5">
            {gaps.map((gap) => (
              <button key={gap.id} onClick={() => openEdit(null, "", [], gap.question)} disabled={remaining <= 0}
                className="w-full text-left p-4 rounded-lg border border-border bg-background hover:border-primary/50 hover:bg-primary/5 transition-all disabled:opacity-50">
                <div className="flex items-start gap-3">
                  <span className="text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-medium capitalize shrink-0 mt-0.5">{gap.dimension}</span>
                  <p className="text-sm leading-relaxed">{gap.question}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── LIST ── */}
      {step === "list" && (
        <div className="flex-1 overflow-y-auto p-6 space-y-3.5">
          {bullets?.map((b: any) => {
            const warnings = quickCheck(b.text, b.tags || []);
            return (
              <div key={b.id} onClick={() => openEdit(b.id, b.text, b.tags || [])}
                className={`p-4 rounded-lg border transition-colors cursor-pointer hover:border-primary/30 ${warnings.length > 0 ? "border-amber-200 dark:border-amber-800/30 bg-amber-50/20 dark:bg-amber-950/10" : "border-green-200 dark:border-green-800/30 bg-green-50/20 dark:bg-green-950/10"}`}>
                {/* Tags */}
                {b.tags?.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mb-2">
                    {b.tags.map((tag: string, i: number) => (
                      <span key={i} className="text-[13px] px-3 py-0.5 bg-secondary text-secondary-foreground rounded-md">{tag}</span>
                    ))}
                  </div>
                )}
                {/* Text */}
                <p className="text-sm leading-relaxed">{b.text}</p>
                {/* Warnings */}
                {warnings.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mt-2.5 pt-2 border-t border-border/20">
                    {warnings.map((w, i) => (
                      <span key={i} className="text-xs px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">○ {w}</span>
                    ))}
                  </div>
                )}
                {warnings.length === 0 && (
                  <div className="mt-2.5 pt-2 border-t border-border/20">
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">✓ Pret pour le tailoring</span>
                  </div>
                )}
              </div>
            );
          })}
          {!bullets?.length && (
            <p className="text-sm text-muted-foreground text-center py-8">Aucun bullet.</p>
          )}
        </div>
      )}

      {/* ── EDIT ── */}
      {step === "edit" && (
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Prompt from detect-gaps question */}
          {editPrompt && (
            <div className="flex items-start gap-3 p-3 rounded-lg border border-blue-200/60 dark:border-blue-800/40 bg-blue-50/30 dark:bg-blue-950/15">
              <HelpCircle className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-800 dark:text-blue-300 leading-relaxed">{editPrompt}</p>
            </div>
          )}

          {/* Textarea */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ton bullet</p>
              <span className={`text-xs font-medium ${charColor}`}>{charCount}/{MAX_CHARS}</span>
            </div>
            <Textarea
              ref={textRef}
              value={editText}
              onChange={e => { const val = e.target.value.slice(0, MAX_CHARS); setEditText(val); setEditEval(null); }}
              onPaste={e => { e.preventDefault(); const pasted = e.clipboardData.getData("text").slice(0, MAX_CHARS); setEditText(pasted); setEditEval(null); }}
              placeholder="Ex: Conception et deploiement d'un design system pour 3 equipes produit, reduisant le temps de maquettage de 30%"
              className="min-h-[100px] text-sm resize-none"
              maxLength={MAX_CHARS}
            />
            {charCount > 0 && charCount < MIN_CHARS && (
              <p className="text-xs text-amber-600 mt-2">Minimum {MIN_CHARS} caracteres ({MIN_CHARS - charCount} restants)</p>
            )}
          </div>

          {/* Tags */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Tags</p>
            <div className="flex gap-2 flex-wrap items-center">
              {editTags.map((tag, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 text-[13px] px-3 py-1 bg-secondary text-secondary-foreground rounded-md">
                  {tag}
                  <button onClick={() => setEditTags(prev => prev.filter((_, j) => j !== i))} className="hover:text-destructive text-muted-foreground">×</button>
                </span>
              ))}
              <input
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
                className="text-[13px] min-w-[120px] flex-1 bg-transparent border-b border-dashed border-muted-foreground/30 outline-none px-2 py-1"
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
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Evaluation</p>
              <div className="flex gap-2 flex-wrap mb-3">
                {CRITERIA.map(({ key, label }) => (
                  <span key={key} className={`text-[13px] px-3.5 py-1 rounded-full font-medium ${
                    editEval[key] ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400" : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                  }`}>
                    {editEval[key] ? "✓" : "○"} {label}
                  </span>
                ))}
              </div>
              {CRITERIA.filter(c => editEval[c.key] === false && editReasons?.[c.key]).map(c => (
                <div key={c.key} className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 p-3 rounded-lg mb-2">
                  <span className="font-medium">{c.label} :</span> {editReasons?.[c.key]}
                </div>
              ))}
            </div>
          )}

          {editSuggestion && (
            <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 p-3 rounded-lg">
              <span className="font-medium">Suggestion :</span> {editSuggestion}
            </div>
          )}
        </div>
      )}

      {/* ── BOTTOM BAR ── */}
      <div className="border-t border-border/50 bg-muted/20 p-5 space-y-2.5 shrink-0">

        {step === "axes" && (
          <>
            <button onClick={() => openEdit(null, "", [])}
              className="w-full text-sm p-3 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-all text-center">
              + Ecrire un bullet librement
            </button>
            {bulletCount > 0 && (
              <Button variant="outline" onClick={fetchGaps} className="w-full h-10">
                <HelpCircle className="w-4 h-4 mr-2" /> Quoi renforcer ?
              </Button>
            )}
          </>
        )}

        {step === "gaps" && (
          <>
            <button onClick={() => openEdit(null, "", [])}
              className="w-full text-sm p-3 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-all text-center">
              + Ecrire un bullet librement
            </button>
            <Button variant="outline" onClick={() => setStep(bulletCount > 0 ? "list" : axes.length > 0 ? "axes" : "edit")} className="w-full h-10">
              Retour
            </Button>
          </>
        )}

        {step === "list" && remaining > 0 && (
          <Button onClick={() => openEdit(null, "", [])} className="w-full h-10">
            <Plus className="w-4 h-4 mr-2" /> Ajouter un bullet ({remaining} restant{remaining > 1 ? "s" : ""})
          </Button>
        )}
        {step === "list" && bulletCount > 0 && (
          <Button variant="outline" onClick={fetchGaps} className="w-full h-10">
            <HelpCircle className="w-4 h-4 mr-2" /> Quoi renforcer ?
          </Button>
        )}
        {step === "list" && remaining > 0 && axes.length > bulletCount && (
          <Button variant="outline" onClick={() => setStep("axes")} className="w-full h-10">
            <Sparkles className="w-4 h-4 mr-2" /> Voir les axes suggeres
          </Button>
        )}

        {step === "edit" && (
          <div className="space-y-2.5">
            {!editEval && !processing && (
              <Button onClick={handleEvaluate} disabled={charCount < MIN_CHARS} variant="outline" className="w-full h-10">
                <Sparkles className="w-4 h-4 mr-2" /> Tagger + Evaluer
              </Button>
            )}
            {processing && (
              <div className="flex items-center justify-center py-2 gap-2 text-sm text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" /> Analyse...
              </div>
            )}
            <Button onClick={handleSave} disabled={!charValid || createBullet.isPending} className="w-full h-10">
              <Check className="w-4 h-4 mr-2" /> {editId ? "Enregistrer" : "Ajouter"}
            </Button>
            <div className="flex gap-2">
              {editEval && !processing && (
                <Button variant="outline" onClick={handleEvaluate} className="h-10 px-3" title="Re-evaluer">
                  <RefreshCw className="w-4 h-4" />
                </Button>
              )}
              <Button variant="outline" onClick={() => setStep(bulletCount > 0 ? "list" : gaps.length > 0 ? "gaps" : axes.length > 0 ? "axes" : "list")} className="flex-1 h-10">
                Retour
              </Button>
            </div>
            {editId && (
              <button onClick={handleDelete} className="w-full text-xs text-destructive hover:underline text-center py-1.5">
                Supprimer ce bullet
              </button>
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
        {!experience && <Button variant="outline"><Plus className="w-4 h-4 mr-2" /> Ajouter une experience</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader><DialogTitle>{experience ? "Modifier" : "Ajouter une experience"}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Titre</Label><Input required value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="Product Designer" /></div>
            <div className="space-y-2"><Label>Entreprise</Label><Input required value={formData.company} onChange={e => setFormData({ ...formData, company: e.target.value })} placeholder="Accor" /></div>
            <div className="space-y-2"><Label>Date debut</Label><Input type="date" value={formData.startDate} onChange={e => setFormData({ ...formData, startDate: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Date fin</Label>
              <Input type="date" value={isCurrent ? "" : formData.endDate} onChange={e => setFormData({ ...formData, endDate: e.target.value })} disabled={isCurrent} className={isCurrent ? "opacity-40" : ""} />
              <label className="flex items-center gap-2 cursor-pointer mt-1" onClick={() => setIsCurrent(!isCurrent)}>
                <div className={`w-8 h-[18px] rounded-full p-0.5 transition-colors ${isCurrent ? "bg-primary" : "bg-border"}`}>
                  <div className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${isCurrent ? "translate-x-3.5" : "translate-x-0"}`} />
                </div>
                <span className="text-xs text-muted-foreground">Poste actuel</span>
              </label>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Type de contrat</Label>
            <div className="flex gap-2">
              {["CDI", "Freelance", "CDD", "Stage", "Alternance"].map(ct => (
                <button key={ct} type="button" onClick={() => setFormData({ ...formData, contractType: formData.contractType === ct ? "" : ct })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${formData.contractType === ct ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/50"}`}>
                  {ct}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2"><Label>Description</Label><Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Description du role..." className="h-24" /></div>
          <DialogFooter className="pt-4 flex justify-between sm:justify-between">
            {experience ? <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleteExp.isPending}>Supprimer</Button> : <div />}
            <Button type="submit" disabled={createExp.isPending || updateExp.isPending}>{experience ? "Enregistrer" : "Creer"}</Button>
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
    <div>
      <div className="flex justify-between items-end mb-4 gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-primary" /> Competences</h2>
          <p className="text-sm text-muted-foreground">Garde uniquement les competences utiles pour tes candidatures cibles.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExtract} disabled={extracting || atLimit} className="gap-2 h-8 text-xs">
            {extracting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {atLimit ? "Limite atteinte" : extracting ? "Analyse..." : "Extraire auto"}
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 text-xs" disabled={atLimit}><Plus className="w-3.5 h-3.5 mr-1" /> Ajouter</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[400px]">
              <DialogHeader><DialogTitle>Ajouter une competence</DialogTitle></DialogHeader>
              <form onSubmit={handleAddManual} className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Nom</Label>
                  <Input required value={addName} onChange={e => setAddName(e.target.value)} placeholder="Figma, User Testing..." />
                </div>
                <div className="space-y-2">
                  <Label>Categorie</Label>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map(cat => (
                      <button key={cat} type="button" onClick={() => setAddCategory(cat)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${addCategory === cat ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/50"}`}>
                        {cat}
                      </button>
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
      </div>

      {/* Skills grouped by category — 2 columns */}
      <div className="bg-card border border-border/70 rounded-xl p-5 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
        {Object.keys(grouped).length === 0 ? (
          <div className="text-center py-6 text-muted-foreground md:col-span-2">
            <p className="text-sm">Aucune competence.</p>
            <p className="text-xs mt-1">Cliquez "Extraire auto" pour detecter vos competences.</p>
          </div>
        ) : (
          Object.entries(grouped).map(([category, catSkills]) => (
            <div key={category}>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{category}</p>
              <div className="flex flex-wrap gap-2">
                {catSkills!.map(skill => (
                  <div key={skill.id} className="group flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-full border border-border/50 hover:border-destructive/30 transition-all">
                    <span className="font-medium text-sm">{skill.name}</span>
                    <button onClick={() => handleDelete(skill.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Review Dialog for extracted skills */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="sm:max-w-[550px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Competences detectees
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Decochez pour exclure. Les competences decochees ne seront <strong>plus jamais reproposees</strong>.</p>
          <div className="space-y-4 py-4">
            {CATEGORIES.map(cat => {
              const catItems = proposed.filter(s => s.category === cat);
              if (!catItems.length) return null;
              return (
                <div key={cat}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{cat}</p>
                  <div className="flex flex-wrap gap-2">
                    {catItems.map((skill, idx) => {
                      const globalIdx = proposed.findIndex(s => s.name === skill.name);
                      return (
                        <button key={idx} onClick={() => {
                          setProposed(prev => prev.map((s, i) => i === globalIdx ? { ...s, accepted: !s.accepted } : s));
                        }}
                          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                            skill.accepted
                              ? "bg-primary/10 text-primary border-primary/30"
                              : "bg-muted text-muted-foreground border-border line-through opacity-50"
                          }`}>
                          {skill.accepted ? <Check className="w-3 h-3 inline mr-1" /> : <X className="w-3 h-3 inline mr-1" />}
                          {skill.name}
                        </button>
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
              {createSkill.isPending ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
              Ajouter {proposed.filter(s => s.accepted).length} competence{proposed.filter(s => s.accepted).length > 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
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
      <DialogTrigger asChild><Button className="gap-2"><Upload className="w-4 h-4" /> Importer un CV</Button></DialogTrigger>
      <DialogContent className="sm:max-w-[650px] max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /> Importer votre CV</DialogTitle></DialogHeader>

        {step === "input" && (
          <div className="space-y-4 py-4">
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
            >
              <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
              <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium text-sm">Deposez votre CV ici ou cliquez</p>
              <p className="text-xs text-muted-foreground mt-1">PDF uniquement</p>
            </div>
            <div className="flex items-center gap-3"><div className="flex-1 h-px bg-border" /><span className="text-xs text-muted-foreground">ou collez le texte</span><div className="flex-1 h-px bg-border" /></div>
            <Textarea value={rawText} onChange={e => setRawText(e.target.value)} placeholder="Collez le contenu de votre CV ou profil LinkedIn ici..." className="h-32 text-sm" />
            <DialogFooter><Button onClick={handleTextSubmit} disabled={!rawText.trim()}>Analyser</Button></DialogFooter>
          </div>
        )}

        {step === "loading" && (
          <div className="py-12 text-center space-y-4">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-primary" />
            <p className="font-medium">Analyse en cours...</p>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">{parsedExps.length} experience{parsedExps.length > 1 ? "s" : ""} trouvee{parsedExps.length > 1 ? "s" : ""}. Decochez celles que vous ne voulez pas.</p>
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
              {parsedExps.map((exp, idx) => (
                <div key={idx} onClick={() => toggleExp(idx)} className={`p-4 rounded-lg border cursor-pointer transition-all ${exp.selected ? "border-primary/50 bg-primary/5" : "border-border opacity-50"}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5 shrink-0 ${exp.selected ? "bg-primary border-primary" : "border-border"}`}>
                      {exp.selected && <Check className="w-3 h-3 text-primary-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">{exp.title}</div>
                      <div className="text-sm text-muted-foreground">{exp.company}</div>
                      {exp.startDate && <div className="text-xs text-muted-foreground mt-1">{exp.startDate} - {exp.endDate || "Present"}</div>}
                      {exp.bullets && exp.bullets.length > 0 && (
                        <div className="mt-2 space-y-1">{exp.bullets.map((b, i) => <div key={i} className="text-xs text-foreground/60 pl-3 border-l-2 border-border">{b}</div>)}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter className="flex gap-2 pt-4">
              <Button variant="outline" onClick={() => { setStep("input"); setParsedExps([]); }}>Retour</Button>
              <Button onClick={handleSaveAll} disabled={saving || selectedCount === 0}>
                {saving ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Import...</> : `Importer ${selectedCount} experience${selectedCount > 1 ? "s" : ""}`}
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
    <div>
      <div className="flex justify-between items-end mb-4 gap-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-primary" /> Formation
        </h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-xs"><Plus className="w-3 h-3 mr-1" /> Ajouter</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader><DialogTitle>Ajouter une formation</DialogTitle></DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4 py-4">
              <div className="space-y-2"><Label>Ecole</Label><Input required value={school} onChange={e => setSchool(e.target.value)} placeholder="Web School Factory" /></div>
              <div className="space-y-2"><Label>Diplome</Label><Input required value={degree} onChange={e => setDegree(e.target.value)} placeholder="Master en Digital Design" /></div>
              <div className="space-y-2"><Label>Annee</Label><Input value={year} onChange={e => setYear(e.target.value)} placeholder="2019" /></div>
              <DialogFooter><Button type="submit">Ajouter</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {formations.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune formation ajoutee.</p>
      ) : (
        <div className="space-y-2">
          {formations.map((f: any) => (
            <div key={f.id} className="group flex items-center justify-between p-3 bg-card rounded-lg border border-border/50">
              <div>
                <p className="text-sm font-medium">{f.degree}</p>
                <p className="text-xs text-muted-foreground">{f.school}{f.year ? ` · ${f.year}` : ""}</p>
              </div>
              <button onClick={() => handleDelete(f.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
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
    <div>
      <div className="flex justify-between items-end mb-4 gap-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" /> Langues
        </h2>
        <Dialog open={addOpen} onOpenChange={(val) => { setAddOpen(val); if (!val) { setName(""); setLevel(""); } }}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-xs"><Plus className="w-3 h-3 mr-1" /> Ajouter</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader><DialogTitle>Ajouter une langue</DialogTitle></DialogHeader>
            <div className="space-y-5 py-4">
              <div className="space-y-2">
                <Label>Langue</Label>
                <div className="flex flex-wrap gap-2">
                  {LANG_SUGGESTIONS.map(l => (
                    <button key={l} type="button" onClick={() => setName(name === l ? "" : l)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${name === l ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/50"}`}>
                      {l}
                    </button>
                  ))}
                </div>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Autre langue..." className="mt-2 h-8 text-sm" />
              </div>
              <div className="space-y-2">
                <Label>Niveau</Label>
                <div className="flex flex-wrap gap-2">
                  {LEVELS.map(l => (
                    <button key={l} type="button" onClick={() => setLevel(level === l ? "" : l)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${level === l ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/50"}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <DialogFooter><Button onClick={handleAdd} disabled={!name.trim()}>Ajouter</Button></DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {langs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune langue ajoutee.</p>
      ) : (
        <div className="space-y-2">
          {langs.map((l: any) => (
            <div key={l.id} className="group flex items-center justify-between p-3 bg-card rounded-lg border border-border/50">
              <div className="flex items-center gap-3">
                <span className="font-medium text-sm">{l.name}</span>
                {l.level && <span className="text-xs text-muted-foreground">{l.level}</span>}
              </div>
              <button onClick={() => handleDelete(l.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

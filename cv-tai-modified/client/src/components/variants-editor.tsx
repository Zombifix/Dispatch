import { useMemo, useState } from "react";
import { Check, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  ANGLE_OPTIONS, LANGUAGE_OPTIONS, useDeleteBulletVariant, useDeleteProfileVariant, useSaveBulletVariant,
  useSaveProfileVariant, useSuggestVariants, useVariants,
} from "@/hooks/use-variants";
import type { Angle, CvLanguage } from "@shared/schema";

type Slot = { angle: Angle; language: CvLanguage };
const slotKey = (s: Slot) => `${s.angle}/${s.language}`;
const angleLabel = (a: string) => ANGLE_OPTIONS.find(o => o.value === a)?.label || a;

/**
 * Formulations d'un fait par angle de candidature et par langue.
 * Le texte du bullet reste la version de base ; chaque formulation est écrite
 * ou validée par l'utilisateur. Le moteur choisit ensuite celle qui colle à l'offre.
 */
export function BulletVariantsEditor({ bulletId, baseText }: { bulletId: string; baseText: string }) {
  const { toast } = useToast();
  const { data } = useVariants();
  const save = useSaveBulletVariant();
  const remove = useDeleteBulletVariant();
  const suggest = useSuggestVariants();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [proposals, setProposals] = useState<Record<string, string>>({});

  const variants = useMemo(() => (data?.bulletVariants || []).filter(v => v.bulletId === bulletId), [data, bulletId]);
  const slots: Slot[] = ANGLE_OPTIONS.flatMap(a => LANGUAGE_OPTIONS.map(l => ({ angle: a.value, language: l })));
  const missing = slots.filter(s => !variants.some(v => v.angle === s.angle && v.language === s.language));

  const doSave = async (slot: Slot, text: string, source: "user" | "suggested") => {
    try {
      await save.mutateAsync({ bulletId, ...slot, text, source });
      setDrafts(d => { const n = { ...d }; delete n[slotKey(slot)]; return n; });
      setProposals(p => { const n = { ...p }; delete n[slotKey(slot)]; return n; });
    } catch (e) {
      toast({ title: "Formulation refusée", description: (e as Error).message, variant: "destructive" });
    }
  };

  const doSuggest = async () => {
    const targets = missing.filter(s => s.angle === "ic" || s.angle === "lead" || s.angle === "consultant").slice(0, 6);
    if (!targets.length) return;
    try {
      const r = await suggest.mutateAsync({ bulletId, targets });
      setProposals(Object.fromEntries(r.proposals.map(p => [slotKey(p), p.text])));
      if (r.rejected.length) {
        toast({ title: `${r.rejected.length} proposition(s) écartée(s)`, description: "Elles ajoutaient ou perdaient une information du fait." });
      }
    } catch (e) {
      toast({ title: "Proposition indisponible", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-4" data-testid="bullet-variants-editor">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Formulations par angle</p>
          <p className="text-xs text-muted-foreground/80 mt-0.5">Le même fait, dit autrement selon le poste visé. Mêmes chiffres, rien d'ajouté.</p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={doSuggest} disabled={suggest.isPending || missing.length === 0}>
          {suggest.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
          Proposer
        </Button>
      </div>

      {variants.map(v => (
        <div key={v.id} className="rounded-md border border-border/50 p-2.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
            <span>{angleLabel(v.angle)} · {v.language}{v.source === "suggested" ? " · proposée puis validée" : ""}</span>
            <button className="hover:text-destructive" onClick={() => remove.mutate(v.id)} aria-label="Supprimer la formulation">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <Textarea
            key={`${v.id}-${new Date(v.updatedAt).getTime()}`}
            defaultValue={v.text}
            className="min-h-[60px] text-sm"
            onBlur={e => {
              const text = e.target.value.trim();
              if (text && text !== v.text) doSave({ angle: v.angle as Angle, language: v.language as CvLanguage }, text, "user");
            }}
          />
        </div>
      ))}

      {Object.entries(proposals).map(([key, text]) => {
        const [angle, language] = key.split("/") as [Angle, CvLanguage];
        return (
          <div key={key} className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-2.5">
            <p className="text-[11px] text-muted-foreground mb-1">Proposition · {angleLabel(angle)} · {language}</p>
            <Textarea value={text} onChange={e => setProposals(p => ({ ...p, [key]: e.target.value }))} className="min-h-[60px] text-sm" />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setProposals(p => { const n = { ...p }; delete n[key]; return n; })}>
                <X className="w-3.5 h-3.5 mr-1" /> Ignorer
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => doSave({ angle, language }, text, "suggested")}>
                <Check className="w-3.5 h-3.5 mr-1" /> Garder
              </Button>
            </div>
          </div>
        );
      })}

      {missing.length > 0 && (
        <AddVariantRow
          missing={missing}
          baseText={baseText}
          draft={drafts}
          setDraft={setDrafts}
          onSave={(slot, text) => doSave(slot, text, "user")}
        />
      )}
    </div>
  );
}

function AddVariantRow({ missing, baseText, draft, setDraft, onSave }: {
  missing: Slot[];
  baseText: string;
  draft: Record<string, string>;
  setDraft: (fn: (d: Record<string, string>) => Record<string, string>) => void;
  onSave: (slot: Slot, text: string) => void;
}) {
  const [slot, setSlot] = useState<string>(slotKey(missing[0]));
  const current = missing.find(s => slotKey(s) === slot) || missing[0];
  const value = draft[slotKey(current)] ?? "";
  return (
    <div className="space-y-2">
      <select
        value={slotKey(current)}
        onChange={e => setSlot(e.target.value)}
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
        aria-label="Angle et langue de la nouvelle formulation"
      >
        {missing.map(s => <option key={slotKey(s)} value={slotKey(s)}>{angleLabel(s.angle)} · {s.language}</option>)}
      </select>
      <Textarea
        value={value}
        placeholder={baseText}
        onChange={e => setDraft(d => ({ ...d, [slotKey(current)]: e.target.value }))}
        className="min-h-[60px] text-sm"
      />
      <div className="flex justify-between items-center">
        <span className={`text-[11px] ${value.length > 0 && (value.length < 40 || value.length > 220) ? "text-amber-600" : "text-muted-foreground"}`}>{value.length}/220</span>
        <Button size="sm" className="h-7 text-xs" disabled={value.trim().length < 40 || value.length > 220} onClick={() => onSave(current, value.trim())}>
          Ajouter la formulation
        </Button>
      </div>
    </div>
  );
}

/** Titres et résumés par angle et langue : jamais générés, choisis par le moteur selon l'offre. */
export function ProfileVariantsEditor() {
  const { toast } = useToast();
  const { data } = useVariants();
  const save = useSaveProfileVariant();
  const remove = useDeleteProfileVariant();
  const [language, setLanguage] = useState<CvLanguage>("FR");
  const list = data?.profileVariants || [];
  const find = (kind: "title" | "summary", angle: Angle) => list.find(v => v.kind === kind && v.angle === angle && v.language === language);
  // Clé de remontage : un champ reflète toujours la dernière valeur enregistrée.
  const fieldKey = (kind: "title" | "summary", angle: Angle) => {
    const v = find(kind, angle);
    return `${kind}-${angle}-${language}-${v ? new Date(v.updatedAt).getTime() : "vide"}`;
  };

  const commit = async (kind: "title" | "summary", angle: Angle, text: string) => {
    const existing = find(kind, angle);
    const value = text.trim();
    try {
      if (!value && existing) await remove.mutateAsync(existing.id);
      else if (value && value !== existing?.text) await save.mutateAsync({ kind, angle, language, text: value });
    } catch (e) {
      toast({ title: "Erreur", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3" data-testid="profile-variants-editor">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Titre et résumé par angle</p>
          <p className="text-xs text-muted-foreground/80 mt-0.5">Le moteur prend celui qui correspond à l'offre. Vide = titre et résumé du profil.</p>
        </div>
        <div className="flex gap-1">
          {LANGUAGE_OPTIONS.map(l => (
            <Button key={l} size="sm" variant={l === language ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setLanguage(l)}>{l}</Button>
          ))}
        </div>
      </div>
      {!data ? (
        <p className="text-xs text-muted-foreground">Chargement…</p>
      ) : ANGLE_OPTIONS.map(a => (
        <div key={`${a.value}-${language}`} className="grid gap-2 md:grid-cols-[150px_1fr]">
          <p className="text-xs font-medium text-muted-foreground pt-2">{a.label}</p>
          <div className="space-y-1.5">
            <Input key={fieldKey("title", a.value)} defaultValue={find("title", a.value)?.text || ""} placeholder="Titre (ex : Lead Product Designer)" className="h-8 text-sm"
              onBlur={e => commit("title", a.value, e.target.value)} />
            <Textarea key={fieldKey("summary", a.value)} defaultValue={find("summary", a.value)?.text || ""} placeholder="Résumé pour cet angle (2-3 phrases, tes mots)" className="min-h-[56px] text-sm"
              onBlur={e => commit("summary", a.value, e.target.value)} />
          </div>
        </div>
      ))}
    </div>
  );
}

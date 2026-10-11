import { useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, Eyebrow } from "@/components/ui/page-header";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Trash2, RefreshCw, Brain, AlertTriangle, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { toast } = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetting, setResetting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/settings/export", { credentials: "include" });
      if (!res.ok) throw new Error("Échec de l'export");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cv-tai-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export terminé", description: "Le fichier JSON a été téléchargé." });
    } catch (err) {
      toast({ title: "Erreur", description: (err as Error).message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const handleReset = async () => {
    if (resetConfirm !== "SUPPRIMER") return;
    setResetting(true);
    try {
      const res = await fetch("/api/settings/reset", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Échec de la réinitialisation");
      toast({ title: "Données réinitialisées", description: "Toutes les données ont été supprimées." });
      setResetOpen(false);
      setResetConfirm("");
      // Reload to clear all cached state
      window.location.href = "/library";
    } catch (err) {
      toast({ title: "Erreur", description: (err as Error).message, variant: "destructive" });
    } finally {
      setResetting(false);
    }
  };

  return (
    <Layout>
      <div className="flex flex-col gap-7">
        <PageHeader
          eyebrow="Paramètres"
          title="Paramètres"
          description="Configuration de l'application."
        />

        <div className="grid items-start gap-7 lg:grid-cols-2">
        {/* ── LLM Configuration ── */}
        <Card variant="panel" className="flex h-full flex-col gap-5 p-6 md:p-8">
          <div className="flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
              <Brain className="size-5" />
            </div>
            <div className="flex flex-col gap-1">
              <CardTitle>Modèle IA</CardTitle>
              <CardDescription>Configuration du moteur d'intelligence artificielle.</CardDescription>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Eyebrow size="sm">Provider actuel</Eyebrow>
            <Card variant="inset" className="flex items-center gap-2 px-4 py-3">
              <span className="text-sm font-medium text-foreground">OpenAI — gpt-4o-mini</span>
              <Badge variant="success" className="ml-auto">Actif</Badge>
            </Card>
          </div>

          <p className="text-sm text-muted-foreground">
            Le changement de provider (OpenAI, Anthropic, Mistral...) sera disponible dans une prochaine version.
            La clé API est configurée dans les variables d'environnement Railway.
          </p>
        </Card>

        {/* ── Export ── */}
        <Card variant="panel" className="flex h-full flex-col gap-5 p-6 md:p-8">
          <div className="flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
              <Download className="size-5" />
            </div>
            <div className="flex flex-col gap-1">
              <CardTitle>Exporter mes données</CardTitle>
              <CardDescription>
                Télécharge toutes tes données (profil, expériences, bullets, compétences, formations, langues, historique) au format JSON.
              </CardDescription>
            </div>
          </div>
          <div>
            <Button variant="outline" onClick={handleExport} disabled={exporting}>
              {exporting ? <RefreshCw className="animate-spin" /> : <Download />}
              Télécharger mes données
            </Button>
          </div>
        </Card>

        {/* ── Danger Zone ── */}
        <Card variant="panel" className="flex flex-col gap-5 border-destructive/30 p-6 md:p-8 lg:col-span-2">
          <div className="flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-destructive-soft text-destructive">
              <AlertTriangle className="size-5" />
            </div>
            <div className="flex flex-col gap-1">
              <CardTitle className="text-destructive">Zone dangereuse</CardTitle>
              <CardDescription>Actions irréversibles.</CardDescription>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-destructive/20 bg-destructive-soft/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-foreground">Réinitialiser toutes les données</p>
              <p className="text-sm text-muted-foreground">Supprime profil, expériences, bullets, compétences, formations, langues et historique.</p>
            </div>
            <Button variant="destructive" size="sm" className="shrink-0" onClick={() => setResetOpen(true)}>
              <Trash2 /> Réinitialiser
            </Button>
          </div>
        </Card>

        {/* Reset Confirmation Dialog */}
        <Dialog open={resetOpen} onOpenChange={(val) => { setResetOpen(val); setResetConfirm(""); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="size-5" /> Réinitialiser les données
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <p className="text-sm text-muted-foreground">
                Cette action est <strong>irréversible</strong>. Toutes tes données seront supprimées :
                profil, expériences, bullets enrichis, compétences, formations, langues, et historique de tailoring.
              </p>
              <div className="flex flex-col gap-2">
                <Label className="text-xs">Tape <strong>SUPPRIMER</strong> pour confirmer</Label>
                <Input
                  inputSize="sm"
                  value={resetConfirm}
                  onChange={e => setResetConfirm(e.target.value)}
                  placeholder="SUPPRIMER"
                  className="font-mono"
                />
              </div>
            </div>
            <DialogFooter className="flex gap-2">
              <Button variant="outline" onClick={() => setResetOpen(false)}>Annuler</Button>
              <Button variant="destructive" onClick={handleReset} disabled={resetConfirm !== "SUPPRIMER" || resetting}>
                {resetting ? <RefreshCw className="animate-spin" /> : <Trash2 />}
                Tout supprimer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>
    </Layout>
  );
}

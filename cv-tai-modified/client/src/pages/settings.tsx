import { useEffect, useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Settings as SettingsIcon, Trash2, RefreshCw, Brain, AlertTriangle, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type SettingsInfo = { aiEnabled: boolean; provider: string; models: Record<string, string>; dailyQuota: number; usedToday: number };

export default function Settings() {
  const { toast } = useToast();
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  useEffect(() => {
    fetch("/api/settings/info", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(setInfo).catch(() => setInfo(null));
  }, []);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Suppression impossible");
      }
      window.location.href = "/login";
    } catch (err) {
      toast({ title: "Erreur", description: (err as Error).message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetting, setResetting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/settings/export", { credentials: "include" });
      if (!res.ok) throw new Error("Echec de l'export");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cv-tai-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export termine", description: "Le fichier JSON a ete telecharge." });
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
      if (!res.ok) throw new Error("Echec de la reinitialisation");
      toast({ title: "Donnees reinitialises", description: "Toutes les donnees ont ete supprimees." });
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
      <div className="max-w-2xl flex flex-col gap-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <SettingsIcon className="w-6 h-6" /> Parametres
          </h1>
          <p className="text-muted-foreground mt-1">Configuration de l'application.</p>
        </div>

        {/* ── LLM Configuration ── */}
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Brain className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Modele IA</h3>
                <p className="text-sm text-muted-foreground">Configuration du moteur d'intelligence artificielle.</p>
              </div>
            </div>

            <div className="space-y-2 pt-2 text-sm">
              {!info ? (
                <p className="text-xs text-muted-foreground">Chargement…</p>
              ) : (
                <>
                  <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg border border-border/50">
                    <span className="font-medium">{info.aiEnabled ? info.provider : "IA non configurée"}</span>
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${info.aiEnabled ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                      {info.aiEnabled ? "Active" : "Assemblage seul"}
                    </span>
                  </div>
                  {info.aiEnabled && (
                    <p className="text-xs text-muted-foreground">
                      Lecture d'offre : {info.models.fast} · retouches : {info.models.writer} · évaluation : {info.models.eval} · similarité : {info.models.embedding}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {info.dailyQuota > 0
                      ? `Quota du jour : ${info.usedToday} / ${info.dailyQuota} unités d'appel IA. Le mode Assemblage n'en consomme presque pas.`
                      : "Pas de quota quotidien."}
                  </p>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Confidentialité ── */}
        <Card>
          <CardContent className="p-6 space-y-3 text-sm">
            <h3 className="font-semibold">Confidentialité</h3>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs">
              <li>Tes données (bibliothèque, offres collées, CV générés, suivi) sont stockées dans la base de cette instance et ne sont pas partagées.</li>
              <li>Quand l'IA est utilisée, le texte de l'offre et les phrases concernées sont envoyés au fournisseur indiqué ci-dessus, uniquement pour la requête.</li>
              <li>Un lien d'offre est récupéré via le service r.jina.ai, puis directement depuis le site si besoin.</li>
              <li>Les journaux techniques ne contiennent ni CV ni email : seulement méthode, chemin, statut et durée.</li>
              <li>Tu peux exporter tes données ou supprimer ton compte à tout moment ci-dessous.</li>
            </ul>
          </CardContent>
        </Card>

        {/* ── Export ── */}
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Download className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Exporter mes donnees</h3>
                <p className="text-sm text-muted-foreground">Telecharge toutes tes donnees (profil, experiences, bullets, skills, formations, langues, historique) au format JSON.</p>
              </div>
            </div>
            <Button variant="outline" onClick={handleExport} disabled={exporting}>
              {exporting ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
              Telecharger mes donnees
            </Button>
          </CardContent>
        </Card>

        {/* ── Danger Zone ── */}
        <Card className="border-destructive/30">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-destructive/10 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <h3 className="font-semibold text-destructive">Zone dangereuse</h3>
                <p className="text-sm text-muted-foreground">Actions irreversibles.</p>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-destructive/5 rounded-lg border border-destructive/20">
              <div>
                <p className="text-sm font-medium">Reinitialiser toutes les donnees</p>
                <p className="text-xs text-muted-foreground mt-0.5">Supprime profil, experiences, bullets, skills, formations, langues et historique.</p>
              </div>
              <Button variant="destructive" size="sm" onClick={() => setResetOpen(true)}>
                <Trash2 className="w-4 h-4 mr-1" /> Reinitialiser
              </Button>
            </div>

            <div className="flex items-center justify-between p-4 bg-destructive/5 rounded-lg border border-destructive/20">
              <div>
                <p className="text-sm font-medium">Supprimer mon compte</p>
                <p className="text-xs text-muted-foreground mt-0.5">Supprime le compte et toutes les données associées, définitivement.</p>
              </div>
              <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)} data-testid="button-delete-account">
                <Trash2 className="w-4 h-4 mr-1" /> Supprimer
              </Button>
            </div>
          </CardContent>
        </Card>

        <Dialog open={deleteOpen} onOpenChange={(val) => { setDeleteOpen(val); setDeletePassword(""); }}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" /> Supprimer le compte
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">Exporte tes données avant si tu veux les garder. Cette action est définitive.</p>
              <Label className="text-xs">Mot de passe</Label>
              <Input type="password" value={deletePassword} onChange={e => setDeletePassword(e.target.value)} autoComplete="current-password" />
            </div>
            <DialogFooter className="flex gap-2">
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>Annuler</Button>
              <Button variant="destructive" onClick={handleDeleteAccount} disabled={!deletePassword || deleting}>
                {deleting ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
                Supprimer définitivement
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reset Confirmation Dialog */}
        <Dialog open={resetOpen} onOpenChange={(val) => { setResetOpen(val); setResetConfirm(""); }}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" /> Reinitialiser les donnees
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Cette action est <strong>irreversible</strong>. Toutes tes donnees seront supprimees :
                profil, experiences, bullets enrichis, competences, formations, langues, et historique de tailoring.
              </p>
              <div className="space-y-2">
                <Label className="text-xs">Tape <strong>SUPPRIMER</strong> pour confirmer</Label>
                <Input
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
                {resetting ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
                Tout supprimer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}

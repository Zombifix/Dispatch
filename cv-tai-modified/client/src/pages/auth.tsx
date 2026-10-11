import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Logo } from "@/components/brand/logo";
import { useCurrentUser, useLogin, useRegister } from "@/hooks/use-auth";

const HERO_IMAGE = "/illustrations/auth-hero.png";

// ─── Hero panel — Figma Login (67:1796) ──────────────────────────────────────
function HeroPanel() {
  return (
    <div className="relative flex h-full min-h-[640px] flex-col justify-between overflow-hidden rounded-3xl p-10 text-white xl:p-16">
      <img src={HERO_IMAGE} alt="" className="pointer-events-none absolute inset-0 size-full object-cover" />

      <div className="relative flex items-center gap-7">
        <p className="text-2xl font-medium leading-7 xl:text-3xl">Un CV, mille candidatures</p>
        <span className="h-px w-[158px] bg-white/70" aria-hidden />
      </div>

      <div className="relative flex max-w-[700px] flex-col gap-5">
        <h2 className="text-5xl font-medium leading-none tracking-normal xl:text-6xl">
          Ne gâche pas
          <br />
          tes chances.
          <br />
          Coupe le bruit.
        </h2>
        <p className="text-lg leading-snug xl:text-xl">
          La bonne version de ton CV fait toute la différence pour décrocher les postes que tu vises.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex w-full flex-col gap-[11px] pt-[5px]">
      <span className="text-base font-medium leading-[14px] text-foreground">{label}</span>
      {children}
    </label>
  );
}

// ─── Auth page ────────────────────────────────────────────────────────────────
export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { data: user } = useCurrentUser();

  const login = useLogin();
  const register = useRegister();
  const mutation = mode === "login" ? login : register;

  useEffect(() => {
    if (user) setLocation("/library");
  }, [user, setLocation]);

  const passwordValid =
    mode === "register" ? /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password) : true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "register" && !passwordValid) {
      setError("8 caractères min., 1 majuscule, 1 minuscule, 1 chiffre.");
      return;
    }
    try {
      if (mode === "register") {
        await register.mutateAsync({ email, password, ...(inviteCode ? { inviteCode } : {}) });
      } else {
        await login.mutateAsync({ email, password });
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="bg-app relative flex min-h-screen items-stretch p-3 md:p-6">
      <div className="relative grid w-full grid-cols-1 overflow-hidden rounded-4xl border border-border/70 bg-card shadow-card lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="hidden p-4 lg:block">
          <HeroPanel />
        </div>

        <div className="flex flex-col items-center justify-center px-6 py-12 md:px-16 xl:px-32">
          <div className="flex w-full max-w-[688px] flex-col items-center gap-[30px]">
            <Logo />

            <div className="flex w-full flex-col items-center gap-7">
              <div className="flex flex-col items-center gap-3 text-center">
                <h1 className="text-4xl font-extrabold tracking-[-0.025em] text-foreground md:text-display-lg">
                  {mode === "login" ? "Bon retour" : "Créer ton compte"}
                </h1>
                <p className="text-lg leading-7 text-muted-foreground">
                  {mode === "login"
                    ? "Entre ton email et ton mot de passe pour te connecter."
                    : "Crée ton compte avec le code d'invitation fourni."}
                </p>
              </div>

              <Segmented
                aria-label="Mode d'authentification"
                className="max-w-[561px]"
                value={mode}
                onChange={(next) => {
                  setMode(next);
                  setError(null);
                }}
                options={[
                  { value: "login", label: "Connexion" },
                  { value: "register", label: "Inscription" },
                ]}
              />

              <form onSubmit={handleSubmit} className="flex w-full flex-col gap-7">
                <Field label="Email">
                  <Input
                    variant="filled"
                    type="email"
                    placeholder="ton.email@exemple.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </Field>

                <div className="flex flex-col gap-3">
                  <Field label="Mot de passe">
                    <Input
                      variant="filled"
                      type="password"
                      placeholder="Ton mot de passe"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                    />
                  </Field>
                  {mode === "register" && password.length > 0 && !passwordValid ? (
                    <p className="text-sm text-muted-foreground">1 maj., 1 min., 1 chiffre, 8 car. min.</p>
                  ) : null}
                </div>

                {mode === "register" ? (
                  <Field label="Code d'invitation">
                    <Input
                      variant="filled"
                      type="text"
                      placeholder="Fourni par l'admin"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                ) : null}

                {error ? <p className="text-center text-sm text-destructive">{error}</p> : null}

                <div className="flex flex-col gap-3">
                  {/* Google sign-in and password reset are hidden until they are actually wired. */}
                  <Button type="submit" size="lg" className="w-full" disabled={mutation.isPending}>
                    {mutation.isPending ? "Chargement..." : mode === "login" ? "Se connecter" : "Créer mon compte"}
                  </Button>

                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, ChevronDown, Clock3, FileText, LogOut, Menu, Settings, SlidersHorizontal, X } from "lucide-react";
import { useCurrentUser, useLogout } from "@/hooks/use-auth";
import { Logo } from "@/components/brand/logo";
import { Mascot } from "@/components/brand/mascot";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavItemDef = {
  title: string;
  url: string;
  icon: React.ElementType<{ className?: string }>;
};

const NAV_ITEMS: NavItemDef[] = [
  { title: "Super CV", url: "/library", icon: FileText },
  { title: "Tailoring", url: "/tailor", icon: SlidersHorizontal },
  { title: "Historique", url: "/history", icon: Clock3 },
  { title: "Paramètres", url: "/settings", icon: Settings },
];

/** Nav item (DA v2): soft-blue active state. `rail` collapses to an icon between lg and 1440px. */
function NavItem({ item, active, rail, onNavigate }: { item: NavItemDef; active: boolean; rail: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={item.url}
      onClick={onNavigate}
      title={rail ? item.title : undefined}
      aria-label={item.title}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-12 items-center gap-3.5 rounded-lg px-4 text-base transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        rail && "lg:justify-center lg:px-0 wide:justify-start wide:px-4",
        active
          ? "bg-primary-soft/60 font-semibold text-primary"
          : "font-medium text-foreground/80 hover:bg-secondary/70 hover:text-foreground [&_svg]:text-muted-foreground",
      )}
    >
      <item.icon className="size-5 shrink-0" />
      <span className={cn(rail && "lg:sr-only wide:not-sr-only")}>{item.title}</span>
    </Link>
  );
}

/** Bottom-of-sidebar tip with the mascot — points to the one action that improves every CV. */
function SidebarTip({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/10 bg-primary-soft/30 p-4">
      <p className="pr-16 text-sm font-semibold leading-5 text-foreground">Enrichis ton Super CV</p>
      <p className="mt-2 text-xs leading-4 text-muted-foreground">Chaque bullet ajouté améliore tes prochains CV.</p>
      <Link href="/library" onClick={onNavigate} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
        Enrichir
        <ArrowRight className="size-3" />
      </Link>
      <Mascot variant="cv" flip className="absolute right-1 top-1 size-16" imgClassName="object-cover object-top" />
    </div>
  );
}

/** App sidebar (DA v2): full height, no section label. `rail`: desktop instance, icon-only between lg and 1440px. */
function Sidebar({ onClose, rail = false }: { onClose?: () => void; rail?: boolean }) {
  const [location] = useLocation();
  const logout = useLogout();

  const isActive = (url: string) =>
    location === url ||
    location.startsWith(`${url}/`) ||
    (url === "/history" && location.startsWith("/results/"));

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      <div className={cn("relative flex items-center px-6 pb-8 pt-8", rail && "lg:justify-center lg:px-0 wide:justify-start wide:px-6")}>
        <Link href="/library" onClick={onClose} aria-label="dispatch. — accueil">
          <Logo wordmarkClassName={cn(rail && "lg:hidden wide:block")} />
        </Link>
        {onClose ? (
          <Button variant="ghost" size="icon-sm" onClick={onClose} className="absolute right-4 lg:hidden" aria-label="Fermer le menu">
            <X />
          </Button>
        ) : null}
      </div>

      <nav className={cn("flex flex-col gap-1.5 px-4", rail && "lg:px-3 wide:px-4")} aria-label="Navigation principale">
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.url} item={item} active={isActive(item.url)} rail={rail} onNavigate={onClose} />
        ))}
      </nav>

      <div className={cn("mt-auto flex flex-col gap-4 px-4 pb-5 pt-8", rail && "lg:px-3 wide:px-4")}>
        <button
          type="button"
          onClick={() => logout.mutate()}
          title={rail ? "Déconnexion" : undefined}
          className={cn(
            "flex h-12 w-full items-center gap-3.5 rounded-lg px-4 text-base font-medium text-foreground/80 transition-colors hover:bg-destructive-soft hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30",
            rail && "lg:justify-center lg:px-0 wide:justify-start wide:px-4",
          )}
        >
          <LogOut className="size-5 shrink-0" />
          <span className={cn(rail && "lg:sr-only wide:not-sr-only")}>Déconnexion</span>
        </button>
        <div className={cn(rail && "lg:hidden wide:block")}>
          <SidebarTip onNavigate={onClose} />
        </div>
      </div>
    </div>
  );
}

function initialsOf(email?: string | null) {
  const local = (email || "").split("@")[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return (letters || "?").toUpperCase();
}

/** Account menu, top-right of every page. */
function UserPill() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const name = user?.email?.split("@")[0] || "Mon compte";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card py-2 pl-2 pr-3 text-left shadow-card transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 md:pr-4"
        aria-label="Menu du compte"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-foreground">
          {initialsOf(user?.email)}
        </span>
        <span className="hidden min-w-0 sm:block md:w-[150px]">
          <span className="block truncate text-sm font-semibold leading-5 text-foreground">{name}</span>
          <span className="block text-sm leading-5 text-muted-foreground">Crédits illimités</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 rounded-lg p-1.5">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{user?.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer gap-2 rounded-md">
          <Link href="/settings">
            <Settings className="size-4" />
            Paramètres
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => logout.mutate()}
          className="cursor-pointer gap-2 rounded-md text-destructive focus:bg-destructive-soft focus:text-destructive"
        >
          <LogOut className="size-4" />
          Déconnexion
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="bg-app flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[88px] shrink-0 border-r border-border/60 bg-surface/80 backdrop-blur-xl lg:block wide:w-[248px]">
        <Sidebar rail />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/30" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[280px] border-r border-border/60 bg-surface">
            <Sidebar onClose={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center px-4 pb-2 pt-4 md:px-8 lg:px-10 lg:pt-5 wide:px-12">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu">
            <Menu className="!size-5" />
          </Button>
          <div className="ml-auto">
            <UserPill />
          </div>
        </header>

        <main className="flex-1 px-4 pb-12 md:px-8 lg:px-10 wide:px-12">
          <div className="mx-auto w-full max-w-content">{children}</div>
        </main>
      </div>
    </div>
  );
}

export { Sidebar as AppSidebar };

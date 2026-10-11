import { Component, type ReactNode } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Mascot } from "@/components/brand/mascot";

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

// ── Error Boundary ──────────────────────────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <Mascot variant="thinking" className="size-32" />
            <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">Quelque chose a planté</h1>
            <p className="text-sm text-muted-foreground">{this.state.error?.message || "Erreur inconnue."}</p>
            <Button
              onClick={() => {
                this.setState({ hasError: false, error: undefined });
                window.location.href = "/library";
              }}
            >
              Retour à la librairie
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

import Library from "./pages/library";
import Tailor from "./pages/tailor";
import Result from "./pages/result";
import History from "./pages/history";
import Settings from "./pages/settings";
import AuthPage from "./pages/auth";

function AuthGate({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <FullPageSpinner />
    );
  }

  if (!user) {
    if (location !== "/login") return <Redirect to="/login" />;
    return <AuthPage />;
  }

  return <>{children}</>;
}

function LoginRoute() {
  const { data: user, isLoading } = useCurrentUser();

  if (isLoading) {
    return (
      <FullPageSpinner />
    );
  }

  if (user) {
    return <Redirect to="/library" />;
  }

  return <AuthPage />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginRoute} />
      <Route path="/" component={() => <Redirect to="/library" />} />
      <Route path="/library" component={() => <AuthGate><Library /></AuthGate>} />
      <Route path="/tailor" component={() => <AuthGate><Tailor /></AuthGate>} />
      <Route path="/history" component={() => <AuthGate><History /></AuthGate>} />
      <Route path="/settings" component={() => <AuthGate><Settings /></AuthGate>} />
      <Route path="/results/:id" component={() => <AuthGate><Result /></AuthGate>} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;

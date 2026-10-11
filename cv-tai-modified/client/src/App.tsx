import { Component, type ReactNode } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useCurrentUser } from "@/hooks/use-auth";

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
        <div className="min-h-screen flex items-center justify-center bg-background/50 p-6">
          <div className="max-w-md text-center space-y-4">
            <div className="text-4xl">💥</div>
            <h1 className="text-xl font-bold text-foreground">Quelque chose a plante</h1>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message || "Erreur inconnue."}
            </p>
            <button
              onClick={() => { this.setState({ hasError: false, error: undefined }); window.location.href = "/library"; }}
              className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Retour a la librairie
            </button>
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
      <div className="min-h-screen flex items-center justify-center bg-background/50">
        <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
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
      <div className="min-h-screen flex items-center justify-center bg-background/50">
        <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
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

import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Mascot } from "@/components/brand/mascot";

export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <Mascot variant="thinking" className="size-40" />
        <h1 className="text-display font-extrabold text-foreground">404</h1>
        <p className="text-base text-muted-foreground">Cette page n’existe pas (ou plus).</p>
        <Button asChild>
          <Link href="/library">Retour au Super CV</Link>
        </Button>
      </div>
    </div>
  );
}

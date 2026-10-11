import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Company logo tile. Shows the scraped logo when there is one, and falls back to the
 * company initial when there is none or the image fails to load (expired CDN link, 404…).
 */
export function CompanyAvatar({
  name,
  logoUrl,
  className,
}: {
  name?: string | null;
  logoUrl?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  const showLogo = Boolean(logoUrl) && !failed;

  return (
    <span
      className={cn(
        "flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/70 text-xl font-semibold text-foreground",
        showLogo ? "bg-card p-2" : "bg-secondary/60",
        className,
      )}
      aria-hidden
    >
      {showLogo ? (
        <img
          src={logoUrl!}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-contain"
          onError={() => setFailed(true)}
          // Favicon services answer unknown domains with a tiny generic globe: prefer the initial.
          onLoad={(event) => {
            if (event.currentTarget.naturalWidth < 32) setFailed(true);
          }}
        />
      ) : (
        initial
      )}
    </span>
  );
}

import { cn } from "@/lib/utils";

type Option<T extends string> = { value: T; label: React.ReactNode };

/** Figma "2 Options / Right Selected" (auth): pill track, primary selected pill. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex h-[43px] w-full items-center gap-1 rounded-full border border-border bg-card p-[3px]", className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-full flex-1 rounded-full text-base tracking-[-0.005em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              selected
                ? "bg-primary font-semibold text-primary-foreground shadow-nav"
                : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

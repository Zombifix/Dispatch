import * as React from "react";
import { cn } from "@/lib/utils";

/** Small uppercase label (section labels, stat labels). Same typeface as the rest of the UI. */
export function Eyebrow({
  className,
  size = "default",
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & { size?: "default" | "sm" }) {
  return (
    <p
      className={cn(
        "font-semibold uppercase text-muted-foreground",
        size === "default" ? "text-eyebrow" : "text-eyebrow-sm",
        className,
      )}
      {...props}
    />
  );
}

type PageHeaderProps = {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

/** Page heading used by every screen: plain eyebrow, large title, muted subtitle, actions on the right. */
export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-5 md:flex-row md:items-end md:justify-between", className)}>
      <div className="flex min-w-0 flex-col items-start gap-2">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="text-3xl font-extrabold leading-tight tracking-[-0.035em] text-foreground md:text-display">{title}</h1>
        {description ? <p className="max-w-[760px] text-base leading-7 text-muted-foreground md:text-lg">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3 md:pb-1">{actions}</div> : null}
    </header>
  );
}

/** Section heading inside a panel: optional eyebrow + 24px title. */
export function SectionTitle({
  eyebrow,
  title,
  description,
  aside,
  size = "default",
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  size?: "default" | "sm";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="flex flex-col gap-1">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h2 className={cn("font-semibold tracking-[-0.025em] text-foreground", size === "sm" ? "text-lg" : "text-2xl")}>{title}</h2>
        {description ? <p className={cn("leading-6 text-muted-foreground", size === "sm" ? "text-sm" : "text-base")}>{description}</p> : null}
      </div>
      {aside}
    </div>
  );
}

type StatItem = {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: React.ReactNode;
  hint?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
};

/** KPI strip (DA v2): one card, items separated by dividers, icon in a soft-blue tile. Items with `onClick` act as filters. */
export function StatGroup({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <div className={cn("surface-card grid grid-cols-2 overflow-hidden rounded-2xl lg:grid-cols-4", className)}>
      {items.map((item, index) => {
        const Comp = item.onClick ? "button" : "div";
        return (
          <Comp
            key={index}
            type={item.onClick ? "button" : undefined}
            onClick={item.onClick}
            aria-pressed={item.onClick ? item.active : undefined}
            className={cn(
              "relative flex items-start gap-4 border-border/60 p-5 text-left md:p-6",
              index % 2 === 1 && "border-l",
              index >= 2 && "border-t lg:border-t-0",
              index === 2 && "lg:border-l",
              item.onClick && "transition-colors hover:bg-primary-soft/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-primary/10",
              item.active && "bg-primary-soft/30",
            )}
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft/70 text-primary [&_svg]:size-5">
              {item.icon}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-3xl font-bold leading-9 tracking-[-0.02em] text-foreground">{item.value}</span>
              <span className="text-base font-semibold text-foreground">{item.label}</span>
              {item.hint ? <span className="mt-1 hidden text-sm leading-5 text-muted-foreground 2xl:block">{item.hint}</span> : null}
            </span>
            {item.active ? <span className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
          </Comp>
        );
      })}
    </div>
  );
}

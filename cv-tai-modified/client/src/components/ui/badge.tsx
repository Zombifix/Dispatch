import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Status pill (history run cards / result header): 11px medium, full radius, optional 12px icon.
 * `tag` is the squarer skill/keyword chip used inside the CV document.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-2xs font-medium [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        primary: "bg-primary-soft text-primary-strong",
        secondary: "bg-secondary text-muted-foreground",
        info: "bg-info-soft text-info",
        success: "bg-success-soft text-success-strong",
        warning: "bg-warning-soft text-warning-strong",
        destructive: "bg-destructive-soft text-destructive",
        outline: "border border-border/60 bg-card text-muted-foreground",
        tag: "rounded-sm border border-primary/20 bg-transparent px-[11px] py-1 text-primary",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants }

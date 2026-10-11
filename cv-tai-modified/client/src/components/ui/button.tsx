import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * DA v2: CTA 48px / radius 12, default 40px. `soft` = light-blue secondary action ("Voir l'analyse").
 * Every clickable action in the app goes through this component — no raw styled <button>.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-cta-gradient text-primary-foreground shadow-cta-sm hover:brightness-110 active:brightness-95",
        destructive:
          "bg-none bg-destructive text-destructive-foreground shadow-none hover:bg-destructive/90",
        outline:
          "border border-border bg-none bg-card text-foreground shadow-xs hover:border-primary/30 hover:bg-secondary/50",
        secondary:
          "bg-none bg-secondary text-foreground hover:bg-secondary/70",
        soft:
          "bg-none bg-primary-soft/60 text-primary hover:bg-primary-soft",
        ghost:
          "bg-none text-muted-foreground hover:bg-secondary hover:text-foreground",
        link:
          "bg-none h-auto min-h-0 px-0 py-0 text-primary hover:underline underline-offset-4",
      },
      size: {
        default: "min-h-10 rounded-lg px-4 py-2 text-sm",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-12 rounded-lg px-5 py-3 text-base font-semibold [&_svg]:size-5 gap-3",
        icon: "size-10 rounded-lg",
        "icon-sm": "size-8 rounded-md",
      },
    },
    compoundVariants: [
      { variant: "default", size: "lg", className: "shadow-cta" },
      { variant: "link", className: "min-h-0 px-0 py-0 text-sm" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }

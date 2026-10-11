import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Figma inputs: 52px tall, radius 20, 1px #e1e7ef border, 16px text, muted placeholder.
 * - default: white field (tailor, library)
 * - filled : #f5f7fb field (auth)
 * - sm     : compact 36px field for dense editors (dialogs, inline tag entry)
 */
const inputVariants = cva(
  "flex w-full border border-border bg-card text-base text-foreground transition-[border-color,box-shadow] placeholder:text-muted-foreground file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "",
        filled: "bg-field",
      },
      inputSize: {
        default: "h-[52px] rounded-xl px-[18px]",
        sm: "h-9 rounded-md px-3 text-sm",
      },
    },
    defaultVariants: { variant: "default", inputSize: "default" },
  },
)

export interface InputProps
  extends React.ComponentProps<"input">,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, inputSize, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(inputVariants({ variant, inputSize }), className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input, inputVariants }

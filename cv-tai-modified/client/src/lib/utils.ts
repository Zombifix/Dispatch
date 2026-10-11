import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Teach tailwind-merge the custom design tokens from tailwind.config.ts, otherwise
// e.g. `text-eyebrow` is mistaken for a color and dropped next to `text-muted-foreground`.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs", "eyebrow", "eyebrow-sm", "display", "display-lg"] }],
      shadow: [{ shadow: ["cta", "cta-sm", "nav", "document", "card", "paper"] }],
      "bg-image": [{ bg: ["cta-gradient", "highlight-panel"] }],
      rounded: [{ rounded: ["4xl"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

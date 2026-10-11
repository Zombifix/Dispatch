import { cn } from "@/lib/utils";

/**
 * The Dispatch mascot — Figma page "Asset" (67:2543 / 67:2548 / 67:2549).
 * Always use this component; never reference the PNGs directly.
 */
const MASCOTS = {
  /** Shouting in a megaphone — tips / help panels */
  megaphone: "/illustrations/mascot-megaphone.png",
  /** Holding a CV — scores, adequacy, success */
  cv: "/illustrations/mascot-cv.png",
  /** Thinking — questions, follow-up, empty states */
  thinking: "/illustrations/mascot-thinking.png",
} as const;

export type MascotVariant = keyof typeof MASCOTS;

type MascotProps = {
  variant: MascotVariant;
  /** Mirror horizontally so the mascot faces the content on its left (as in the mockups). */
  flip?: boolean;
  className?: string;
  imgClassName?: string;
  alt?: string;
};

export function Mascot({ variant, flip = false, className, imgClassName, alt = "" }: MascotProps) {
  return (
    <span aria-hidden={alt ? undefined : true} className={cn("pointer-events-none relative block select-none overflow-hidden", className)}>
      <img
        src={MASCOTS[variant]}
        alt={alt}
        draggable={false}
        loading="lazy"
        className={cn("h-full w-full object-contain", flip && "-scale-x-100", imgClassName)}
      />
    </span>
  );
}

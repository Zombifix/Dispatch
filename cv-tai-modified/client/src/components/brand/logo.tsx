import { cn } from "@/lib/utils";

/** Figma "Logo name" (62:11868): mark 15.5×16.2 + wordmark 129×28, gap 10. */
export function Logo({ className, wordmarkClassName }: { className?: string; wordmarkClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <img src="/brand/logo-mark.svg" alt="" width={15.5} height={16.2} className="h-[16.2px] w-[15.5px]" />
      <img src="/brand/logo-wordmark.svg" alt="dispatch." width={129} height={28} className={cn("h-7 w-[129px]", wordmarkClassName)} />
    </span>
  );
}

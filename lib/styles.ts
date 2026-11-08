// Shared class strings for the page.
//
// Monochrome on an opacity scale, Inter, a 4pt grid, expressed through the
// host's `foreground` token so the page keeps working with custom palettes and
// dark mode. Accents are semantic only.
import { cn } from "@/lib/utils";

export const FONT_SANS =
  "[font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe_UI',sans-serif]";
export const TYPE_LABEL =
  "text-[11px] font-semibold uppercase leading-normal tracking-[0.1em]";
export const FOCUS_RING =
  "outline-none focus-visible:border-foreground focus-visible:ring-[3px] focus-visible:ring-foreground/10";

export const BUTTON_CLASS = cn(
  "inline-flex h-9 shrink-0 items-center justify-center gap-[6px] rounded-[10px] border-[1.5px] px-3 text-[14px] font-medium transition-[background-color,border-color,color,transform] duration-[120ms] ease-[ease] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:active:scale-100",
  FOCUS_RING,
);
export const BUTTON_SECONDARY = cn(
  BUTTON_CLASS,
  "border-foreground/20 bg-transparent text-foreground hover:border-foreground/50 hover:bg-foreground/5",
);
export const BUTTON_PRIMARY = cn(
  BUTTON_CLASS,
  "border-foreground bg-foreground text-background hover:bg-foreground/80",
);

export const CHIP =
  "inline-flex max-w-full items-center gap-1 rounded-full px-[9px] py-1 text-[12px] font-medium leading-none";
export const CHIP_MUTED = cn(CHIP, "bg-foreground/10 text-foreground/80");
export const CHIP_OUTLINE = cn(
  CHIP,
  "border border-foreground/20 px-[8px] py-[3px] text-foreground/80 transition-[border-color,color] duration-[120ms] ease-[ease] hover:border-foreground/50 hover:text-foreground",
  FOCUS_RING,
);
/** Something missing, e.g. a link to no memory. */
export const CHIP_DASHED = cn(
  CHIP,
  "border border-dashed border-foreground/20 px-[8px] py-[3px] text-foreground/60",
);
/** Waiting on the user, e.g. an unconfirmed preference. */
export const CHIP_ATTENTION = cn(CHIP, "bg-[#FF9500]/10 text-[#FF9500]");

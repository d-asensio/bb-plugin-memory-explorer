// A memory type's icon on a tint of its colour (type-style.ts).
import { useEffect, useState } from "react";
import { typeStyle } from "../type-style";
import { cn } from "@/lib/utils";

/** True while the host shows dark mode, read from its background colour. */
export function useDarkMode(): boolean {
  const read = () => {
    if (typeof window === "undefined") return false;
    const probe = document.createElement("span");
    probe.style.color = "var(--background, #fff)";
    document.body.appendChild(probe);
    const rgb = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).map(Number);
    probe.remove();
    if (rgb.length < 3) return window.matchMedia("(prefers-color-scheme: dark)").matches;
    return (0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!) / 255 < 0.45;
  };
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const update = () => setDark(read());
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", update);
    const observer = new MutationObserver(update);
    for (const element of [document.documentElement, document.body]) {
      observer.observe(element, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    }
    return () => {
      scheme.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  return dark;
}

const SIZES = {
  xs: { box: "size-[18px] rounded-full", glyph: 11 },
  sm: { box: "size-[22px] rounded-[6px]", glyph: 13 },
  md: { box: "size-[30px] rounded-[8px]", glyph: 16 },
  lg: { box: "size-[40px] rounded-[10px]", glyph: 21 },
} as const;

export function TypeIcon({
  type,
  dark,
  size = "md",
  className,
}: {
  type: string;
  dark: boolean;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const style = typeStyle(type);
  const color = dark ? style.dark : style.light;
  const { box, glyph } = SIZES[size];
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center", box, className)}
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} ${dark ? 22 : 14}%, transparent)` }}
    >
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: style.icon }}
      />
    </span>
  );
}

/** A small dot in the type's colour, then its label. */
export function TypeLabel({ type, dark }: { type: string; dark: boolean }) {
  const style = typeStyle(type);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-muted-foreground">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: dark ? style.dark : style.light }}
      />
      {style.label}
    </span>
  );
}

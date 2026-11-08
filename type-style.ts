// How each memory type looks on the page: its
// label, its icon (Lucide paths, so the table, the drawer and the graph's
// canvas draw the same glyph) and its colour in light and dark mode. Pure and
// browser-safe.

export interface TypeStyle {
  label: string;
  /** Inner SVG markup of a 24×24 Lucide icon, stroked with currentColor. */
  icon: string;
  light: string;
  dark: string;
}

const ICONS = {
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  building:
    '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  server:
    '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  shapes:
    '<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
  sliders:
    '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  scale:
    '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  checks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
  bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6M10 22h4"/>',
  history:
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  dot: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/>',
} as const;

const STYLES: Record<string, TypeStyle> = {
  person: { label: "Person", icon: ICONS.user, light: "#2563eb", dark: "#60a5fa" },
  company: { label: "Company", icon: ICONS.building, light: "#7c3aed", dark: "#a78bfa" },
  team: { label: "Team", icon: ICONS.users, light: "#4f46e5", dark: "#818cf8" },
  system: { label: "System", icon: ICONS.server, light: "#475569", dark: "#94a3b8" },
  integration: { label: "Integration", icon: ICONS.plug, light: "#0d9488", dark: "#2dd4bf" },
  meeting: { label: "Meeting", icon: ICONS.calendar, light: "#ea580c", dark: "#fb923c" },
  initiative: { label: "Initiative", icon: ICONS.flag, light: "#16a34a", dark: "#4ade80" },
  other: { label: "Other", icon: ICONS.shapes, light: "#737373", dark: "#a3a3a3" },
  preference: { label: "Preference", icon: ICONS.sliders, light: "#db2777", dark: "#f472b6" },
  decision: { label: "Decision", icon: ICONS.scale, light: "#dc2626", dark: "#f87171" },
  procedure: { label: "Procedure", icon: ICONS.checks, light: "#0891b2", dark: "#22d3ee" },
  fact: { label: "Fact", icon: ICONS.bulb, light: "#ca8a04", dark: "#facc15" },
  episode: { label: "Episode", icon: ICONS.history, light: "#b45309", dark: "#f59e0b" },
  reference: { label: "Reference", icon: ICONS.bookmark, light: "#64748b", dark: "#94a3b8" },
};

/** A type no style names: its own name, capitalised, with a neutral dot. */
export function typeStyle(type: string): TypeStyle {
  const known = STYLES[type];
  if (known !== undefined) return known;
  const label = type === "" ? "Unknown" : type[0]!.toUpperCase() + type.slice(1);
  return { label, icon: ICONS.dot, light: "#737373", dark: "#a3a3a3" };
}

/** The colour of `type` in the current mode. */
export function typeColor(type: string, dark: boolean): string {
  const style = typeStyle(type);
  return dark ? style.dark : style.light;
}

/** A standalone SVG document of the type's icon, stroked in `stroke`, for an <img> or a canvas. */
export function typeIconSvg(type: string, stroke: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${typeStyle(type).icon}</svg>`;
}

/** `ms` before `now` in words: today, yesterday, 5d ago, or a date. */
export function relativeDay(ms: number, now: number): string {
  const days = Math.floor((now - ms) / 86_400_000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Name prefixes of memories that are not entities, as `memoryType` reads them. */
const KIND_PREFIXES = new Set(["pref", "proc", "ref", "fact", "episode", "decision", "preference", "procedure", "reference"]);

/**
 * What the page calls a memory. An entity keeps its label; a memory whose
 * label is just its name (`proc.check-what-reached-production`) gets the name
 * without its kind prefix, in words: "Check what reached production".
 */
export function conceptTitle(label: string, name: string): string {
  if (label !== name) return label;
  const parts = name.split(".");
  const rest = parts.length > 1 && KIND_PREFIXES.has(parts[0]!) ? parts.slice(1) : parts;
  const words = rest.join(" ").replace(/[-_]+/g, " ").trim();
  return words === "" ? name : words[0]!.toUpperCase() + words.slice(1);
}

/** The summary without the "Label (type) — " an entity's summary starts with. */
export function conceptSummary(summary: string, label: string, type: string): string {
  const head = `${label} (${type})`;
  if (!summary.startsWith(head)) return summary;
  return summary.slice(head.length).replace(/^\s*[—–:·-]\s*/, "").trim() || summary;
}

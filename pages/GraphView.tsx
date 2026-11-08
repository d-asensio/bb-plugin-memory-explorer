// The memory graph: memories as nodes, their links as
// lines, on a canvas.
//
// graph-layout.ts holds the geometry (force layout, outer ring for unconnected
// nodes, fitting, zooming, hit testing, label placement); this file draws it.
// Every node is a circle in its type's colour with the type's icon inside
// (type-style.ts), the same icon the table and the drawer show. Solid lines are
// relations, dashed ones mentions.
//
// Interaction: hovering shows a tooltip and lights the node's neighbours; a
// click selects a node, a second click (or a click on the background) clears.
// The wheel and the + / − buttons zoom about the cursor or the centre, dragging
// the background pans, and dragging a node moves it and pins it there (a dot
// marks it); double-clicking a pinned node releases it, and Release releases
// them all. With a `pinKey`, pins survive the graph being unmounted (switching
// tabs) for as long as the page is loaded. Colours follow the host's light or
// dark theme through its CSS variables.
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import {
  fitView,
  layoutGraph,
  nodeAt,
  placeLabels,
  toLayout,
  zoomView,
  type View,
} from "../graph-layout";
import { ENTITY_TYPES, KIND_TYPES, type GraphEdge, type GraphNode } from "../knowledge";
import { typeColor, typeIconSvg } from "../type-style";
import { TypeIcon } from "./TypeIcon";
import { Icon } from "@/components/ui/icon";
import { FOCUS_RING } from "@/lib/styles";
import { cn } from "@/lib/utils";

interface Theme {
  fg: string;
  muted: string;
  surface: string;
  dark: boolean;
}

/** The computed colour of `var(<prop>, <fallback>)` for an element inside `host`. */
function resolveColor(host: HTMLElement, prop: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${prop}, ${fallback})`;
  host.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** Rough lightness, 0 to 1, of a computed colour: rgb(), color(), lab(), lch(), oklab(), oklch(). */
function lightness(color: string): number {
  const args = color.slice(color.indexOf("(") + 1).replace(/^\s*[a-z][\w-]*\s+/i, "");
  const n = args.match(/-?[\d.]+%?/g) ?? [];
  if (n.length === 0) return 1;
  const v = (i: number) => Number.parseFloat(n[i] ?? "0");
  if (/^rgba?\(/.test(color)) return (0.2126 * v(0) + 0.7152 * v(1) + 0.0722 * v(2)) / 255;
  if (/^color\(/.test(color)) return 0.2126 * v(0) + 0.7152 * v(1) + 0.0722 * v(2);
  if (n[0]!.endsWith("%")) return v(0) / 100;
  return /^(lab|lch)\(/.test(color) ? v(0) / 100 : v(0);
}

function readTheme(host: HTMLElement): Theme {
  const fg = resolveColor(host, "--foreground", "#0b0b0b");
  const muted = resolveColor(host, "--muted-foreground", "#898781");
  const surface = resolveColor(host, "--card", "#fcfcfb");
  const clear = surface === "transparent" || /rgba\(.*,\s*0\)$/.test(surface);
  const dark = clear
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : lightness(surface) < 0.45;
  return { fg, muted, surface, dark };
}

/** The host's colours, read again when its theme or the system's colour scheme changes. */
function useTheme(ref: RefObject<HTMLElement | null>): Theme | null {
  const [theme, setTheme] = useState<Theme | null>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (host === null) return;
    const read = () => {
      const next = readTheme(host);
      setTheme((previous) =>
        previous !== null &&
        previous.fg === next.fg &&
        previous.muted === next.muted &&
        previous.surface === next.surface &&
        previous.dark === next.dark
          ? previous
          : next,
      );
    };
    read();
    // Several attribute changes in one frame are read once.
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", update);
    const observer = new MutationObserver(update);
    for (const element of [document.documentElement, document.body]) {
      observer.observe(element, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    }
    return () => {
      cancelAnimationFrame(frame);
      scheme.removeEventListener("change", update);
      observer.disconnect();
    };
  }, [ref]);
  return theme;
}

/** The element's inner width in pixels, kept current. */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => setWidth(Math.floor(element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** White type icons for the canvas, decoded once per page; `onReady` runs as each one loads. */
const ICON_IMAGES = new Map<string, HTMLImageElement>();
function iconImage(type: string, onReady: () => void): HTMLImageElement {
  let image = ICON_IMAGES.get(type);
  if (image === undefined) {
    image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(typeIconSvg(type, "#ffffff"))}`;
    ICON_IMAGES.set(type, image);
  }
  if (!image.complete) image.addEventListener("load", onReady, { once: true });
  return image;
}

/** Pinned positions (layout units) by pin key, kept while the page is loaded. */
const SHARED_PINS = new Map<string, Map<string, { x: number; y: number }>>();

const LABEL_FONT = "11px Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
/** Unfocused, a graph this small labels every node; a larger one only nodes with LABEL_MIN_DEGREE links. */
const LABEL_ALL_UP_TO = 20;
const LABEL_MIN_DEGREE = 5;
/** Zoomed in this far past the fitted view, every node gets a label. */
const LABEL_ALL_ZOOM = 1.8;
/** Pointer travel, in pixels, that turns a press into a drag. */
const DRAG_SLOP = 4;
const ZOOM_STEP = 1.3;
/**
 * Layout gap kept between linked nodes beyond their radii. Measured on the
 * real memory graph (110 nodes, 185 links, 1000×600 canvas): 25 overlapping
 * pairs at 0, none closer than 12px from 56 up.
 */
const SPREAD_GAP = 60;

/** Drawn radius in pixels: the layout radius plus room for the icon, growing gently with zoom. */
function drawnRadius(r: number, zoom: number): number {
  return (r + 6) * Math.min(1.8, Math.max(0.7, Math.sqrt(zoom)));
}

export interface GraphViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** The focused node: it and its neighbours stand out, the rest fades. */
  selected: string | null;
  /** The clicked node, or null for a click on the selected node or on the background. */
  onSelect(name: string | null): void;
  /** Canvas height in pixels; by default 360 when the canvas is narrower than 520, else 440. */
  height?: number;
  /** Draw mentions (dashed); relations always show. Default true. */
  showMentions?: boolean;
  /** Search matches, standing out while no node is focused; null when there is no search. */
  highlight?: ReadonlySet<string> | null;
  /** Wheel zoom and the zoom buttons. Default true; off for a graph inside a scrolling panel. */
  controls?: boolean;
  /** Keep pinned nodes under this key across mounts; without one, pins live as long as the graph. */
  pinKey?: string;
  /** The legend of types under the canvas. Default true. */
  legend?: boolean;
}

type Press =
  | { kind: "node"; name: string; x: number; y: number; moved: boolean }
  | { kind: "pan"; x: number; y: number; view: View; moved: boolean };

export function GraphView({
  nodes,
  edges,
  selected,
  onSelect,
  height,
  showMentions = true,
  highlight = null,
  controls = true,
  pinKey,
  legend = true,
}: GraphViewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  // The hovered node; changing it redraws without a render.
  const hoverRef = useRef<string | null>(null);
  const pressRef = useRef<Press | null>(null);
  const width = useWidth(frameRef);
  const theme = useTheme(frameRef);
  const canvasHeight = height ?? (width < 520 ? 360 : 440);
  // Bumped when an icon loads or the pins change, to draw again.
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  const ownPins = useRef(new Map<string, { x: number; y: number }>());
  const pins = useMemo(() => {
    if (pinKey === undefined) return ownPins.current;
    let shared = SHARED_PINS.get(pinKey);
    if (shared === undefined) {
      shared = new Map();
      SHARED_PINS.set(pinKey, shared);
    }
    return shared;
  }, [pinKey]);

  const byName = useMemo(() => new Map(nodes.map((node) => [node.name, node])), [nodes]);
  const shown = useMemo(
    () =>
      edges.filter(
        (e) =>
          (showMentions || e.type === "relation") && byName.has(e.source) && byName.has(e.target),
      ),
    [edges, showMentions, byName],
  );
  // Laid out again only when the nodes or links change, not for equal new arrays.
  const layoutKey = `${[...byName.keys()].sort().join("\n")}\u0000${shown
    .map((e) => `${e.source}\n${e.target}`)
    .sort()
    .join("\u0001")}`;
  // The canvas shape, in quarter steps, so resizing a little does not lay out again.
  const aspect =
    width === 0 ? 1 : Math.min(2.5, Math.max(1, Math.round((width / canvasHeight) * 4) / 4));
  const points = useMemo(
    () =>
      layoutGraph(
        [...byName.keys()],
        shown.map((e) => [e.source, e.target] as const),
        { aspect, collide: SPREAD_GAP },
      ),
    // byName and shown are what layoutKey describes.
    [layoutKey, aspect],
  );
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const link = (from: string, to: string) => {
      const set = map.get(from) ?? new Set<string>();
      set.add(to);
      map.set(from, set);
    };
    for (const e of shown) {
      link(e.source, e.target);
      link(e.target, e.source);
    }
    return map;
  }, [shown]);
  const fit = useMemo(() => fitView(points, width, canvasHeight), [points, width, canvasHeight]);
  // The user's camera; null follows the fitted view.
  const [camera, setCamera] = useState<View | null>(null);
  useEffect(() => setCamera(null), [fit]);
  const view = camera ?? fit;
  const zoom = view.scale / fit.scale;

  /** Every node where it is drawn now, in canvas pixels. */
  const placed = useCallback(
    () =>
      points.map((p) => {
        const at = pins.get(p.name) ?? p;
        return {
          name: p.name,
          degree: p.degree,
          x: at.x * view.scale + view.ox,
          y: at.y * view.scale + view.oy,
          r: drawnRadius(p.r, zoom),
          pinned: pins.has(p.name),
        };
      }),
    [points, pins, view, zoom],
  );
  const hitAt = (x: number, y: number) =>
    nodeAt(placed(), { scale: 1, ox: 0, oy: 0 }, x, y);

  function draw(): void {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    if (canvas === null || ctx === null || theme === null || width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(canvasHeight * ratio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, canvasHeight);

    const drawn = placed();
    const at = new Map(drawn.map((p) => [p.name, p]));
    const hover = hoverRef.current !== null && byName.has(hoverRef.current) ? hoverRef.current : null;
    const focus = selected !== null && byName.has(selected) ? selected : hover;
    // What stands out: the focus and its neighbours, else the search matches, else everything.
    const lit = focus === null ? highlight : new Set([focus, ...(neighbours.get(focus) ?? [])]);

    ctx.lineCap = "round";
    for (const e of shown) {
      const relation = e.type === "relation";
      const normal = relation ? 0.5 : 0.35;
      const touches = focus !== null && (e.source === focus || e.target === focus);
      ctx.globalAlpha =
        focus !== null
          ? touches
            ? 0.9
            : 0.06
          : highlight !== null
            ? highlight.has(e.source) || highlight.has(e.target)
              ? normal
              : 0.06
            : normal;
      ctx.strokeStyle = touches ? typeColor(byName.get(focus!)!.type, theme.dark) : theme.muted;
      ctx.lineWidth = (relation ? 1.5 : 1) * (touches ? 1.4 : 1);
      ctx.setLineDash(relation ? [] : [4, 3]);
      const a = at.get(e.source)!;
      const b = at.get(e.target)!;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Faded nodes first and the focus last, so what stands out is on top.
    const rank = (name: string) => (name === focus ? 2 : lit === null || lit.has(name) ? 1 : 0);
    for (const p of [...drawn].sort((a, b) => rank(a.name) - rank(b.name))) {
      const type = byName.get(p.name)!.type;
      const color = typeColor(type, theme.dark);
      const focused = p.name === focus;
      ctx.globalAlpha = rank(p.name) === 0 ? 0.18 : 1;
      if (focused) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 5, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.22;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.surface;
      ctx.stroke();
      const image = iconImage(type, redraw);
      if (image.complete && image.naturalWidth > 0) {
        const size = p.r * 1.1;
        ctx.drawImage(image, p.x - size / 2, p.y - size / 2, size, size);
      }
      if (p.pinned) {
        ctx.beginPath();
        ctx.arc(p.x + p.r * 0.72, p.y - p.r * 0.72, 3, 0, 2 * Math.PI);
        ctx.fillStyle = theme.fg;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = theme.surface;
        ctx.stroke();
      }
    }

    // Labels: the focus first, then by link count; one that would overlap a label already drawn is skipped.
    ctx.globalAlpha = 1;
    ctx.font = LABEL_FONT;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const wanted = drawn
      .filter((p) =>
        lit !== null
          ? lit.has(p.name)
          : zoom >= LABEL_ALL_ZOOM || drawn.length <= LABEL_ALL_UP_TO || p.degree >= LABEL_MIN_DEGREE,
      )
      .filter((p) => p.x > -40 && p.x < width + 40 && p.y > -20 && p.y < canvasHeight + 20)
      .sort(
        (a, b) =>
          Number(b.name === focus) - Number(a.name === focus) ||
          b.degree - a.degree ||
          (a.name < b.name ? -1 : 1),
      );
    const labels = placeLabels(
      wanted.map((p) => ({ name: p.name, text: byName.get(p.name)!.label, x: p.x, y: p.y, r: p.r })),
      width,
      (text) => ctx.measureText(text).width,
    );
    ctx.lineWidth = 3;
    for (const label of labels) {
      ctx.textAlign = label.align;
      ctx.strokeStyle = theme.surface;
      ctx.strokeText(label.text, label.x, label.y);
      ctx.fillStyle = theme.fg;
      ctx.fillText(label.text, label.x, label.y);
    }
  }

  // Every render draws; hovering and dragging redraw on their own.
  useEffect(draw);

  // The wheel zooms about the cursor; React's onWheel is passive, so this listener is added by hand.
  const zoomRef = useRef<(factor: number, x: number, y: number) => void>(() => {});
  zoomRef.current = (factor, x, y) => setCamera((current) => zoomView(current ?? fit, fit, factor, x, y));
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !controls) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomRef.current(Math.exp(-delta * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [controls]);

  function pointer(event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function showTip(name: string | null, x: number, y: number): void {
    const tip = tipRef.current;
    if (tip === null) return;
    if (name === null) {
      tip.style.display = "none";
      return;
    }
    const node = byName.get(name)!;
    const degree = neighbours.get(name)?.size ?? 0;
    tip.textContent = `${node.label} · ${node.type} · ${degree} link${degree === 1 ? "" : "s"}${
      pins.has(name) ? " · pinned, double-click to release" : ""
    }`;
    tip.style.display = "block";
    tip.style.left = `${Math.max(4, Math.min(x + 12, width - tip.offsetWidth - 8))}px`;
    const below = y + 14;
    tip.style.top = `${below + tip.offsetHeight > canvasHeight - 4 ? Math.max(4, y - tip.offsetHeight - 10) : below}px`;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (event.button !== 0) return;
    const { x, y } = pointer(event);
    const hit = hitAt(x, y);
    event.currentTarget.setPointerCapture(event.pointerId);
    pressRef.current =
      hit === null
        ? { kind: "pan", x, y, view, moved: false }
        : { kind: "node", name: hit, x, y, moved: false };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const { x, y } = pointer(event);
    const press = pressRef.current;
    if (press !== null) {
      if (!press.moved && Math.hypot(x - press.x, y - press.y) < DRAG_SLOP) return;
      press.moved = true;
      event.currentTarget.style.cursor = "grabbing";
      showTip(null, 0, 0);
      if (press.kind === "node") {
        pins.set(press.name, toLayout(view, x, y));
        draw();
      } else {
        setCamera({ ...press.view, ox: press.view.ox + x - press.x, oy: press.view.oy + y - press.y });
      }
      return;
    }
    const hit = hitAt(x, y);
    event.currentTarget.style.cursor = hit === null ? "grab" : "pointer";
    if (hit !== hoverRef.current) {
      hoverRef.current = hit;
      draw();
    }
    showTip(hit, x, y);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const press = pressRef.current;
    pressRef.current = null;
    if (press === null) return;
    event.currentTarget.style.cursor = press.kind === "node" ? "pointer" : "grab";
    if (press.moved) {
      if (press.kind === "node") redraw();
      return;
    }
    const hit = press.kind === "node" ? press.name : null;
    onSelect(hit === selected ? null : hit);
  }

  function onDoubleClick(event: ReactMouseEvent<HTMLCanvasElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const hit = hitAt(event.clientX - rect.left, event.clientY - rect.top);
    if (hit !== null && pins.delete(hit)) redraw();
  }

  function onPointerLeave(): void {
    if (pressRef.current !== null) return;
    hoverRef.current = null;
    showTip(null, 0, 0);
    draw();
  }

  const pinned = points.filter((p) => pins.has(p.name)).length;
  const zoomBy = (factor: number) => zoomRef.current(factor, width / 2, canvasHeight / 2);

  return (
    <div className="flex flex-col gap-2">
      <div ref={frameRef} className="relative overflow-hidden rounded-[12px] border border-border bg-card">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Graph of ${nodes.length} memories and ${shown.length} links`}
          className="block w-full touch-none select-none"
          style={{ height: canvasHeight, cursor: "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (pressRef.current = null)}
          onPointerLeave={onPointerLeave}
          onDoubleClick={onDoubleClick}
        />
        <div
          ref={tipRef}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 z-[2] hidden whitespace-nowrap rounded-[6px] border border-border bg-popover px-2 py-1 text-[12px] text-popover-foreground shadow-sm"
        />
        {controls ? (
          <div className="absolute bottom-3 right-3 z-[3] flex flex-col items-stretch overflow-hidden rounded-[8px] border border-border bg-popover text-popover-foreground shadow-sm">
            <ZoomButton label="Zoom in" icon={GLYPH.plus} onClick={() => zoomBy(ZOOM_STEP)} />
            <span
              aria-live="polite"
              className="px-1 py-0.5 text-center text-[10px] tabular-nums text-muted-foreground"
            >
              {Math.round(zoom * 100)}%
            </span>
            <ZoomButton label="Zoom out" icon={GLYPH.minus} onClick={() => zoomBy(1 / ZOOM_STEP)} />
            <span className="h-px bg-border" />
            <ZoomButton label="Fit to screen" icon={GLYPH.fit} onClick={() => setCamera(null)} />
          </div>
        ) : null}
        {pinned === 0 ? null : (
          <button
            type="button"
            onClick={() => {
              for (const p of points) pins.delete(p.name);
              redraw();
            }}
            className={cn(
              "absolute left-3 top-3 z-[3] inline-flex h-7 items-center gap-1.5 rounded-[8px] border border-border bg-popover px-2.5 text-[12px] text-popover-foreground shadow-sm transition-colors hover:bg-accent",
              FOCUS_RING,
            )}
          >
            <Icon name="RotateCcw" className="size-3.5" aria-hidden />
            Release {pinned} pinned
          </button>
        )}
      </div>
      {legend ? <Legend nodes={nodes} dark={theme?.dark ?? false} /> : null}
    </div>
  );
}

const GLYPH = {
  plus: "M5 12h14M12 5v14",
  minus: "M5 12h14",
  fit: "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3",
} as const;

function ZoomButton({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center text-foreground transition-colors hover:bg-accent",
        FOCUS_RING,
      )}
    >
      <svg
        aria-hidden
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={icon} />
      </svg>
    </button>
  );
}

/** Every type present, in the chips' order, with its icon, colour and count. */
function Legend({ nodes, dark }: { nodes: GraphNode[]; dark: boolean }) {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  const known: readonly string[] = [...ENTITY_TYPES, ...KIND_TYPES];
  const types = [
    ...known.filter((type) => counts.has(type)),
    ...[...counts.keys()].filter((type) => !known.includes(type)).sort(),
  ];
  if (types.length === 0) return null;
  return (
    <ul aria-label="Legend" className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12px] text-muted-foreground">
      {types.map((type) => (
        <li key={type} className="inline-flex items-center gap-[5px]">
          <TypeIcon type={type} dark={dark} size="xs" />
          {type}
          <span className="tabular-nums opacity-70">{counts.get(type)}</span>
        </li>
      ))}
    </ul>
  );
}

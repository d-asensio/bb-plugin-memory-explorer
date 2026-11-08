// The memory graph: memories as nodes, their links as
// lines, on a canvas.
//
// graph-layout.ts holds the geometry (force layout, outer ring for unconnected
// nodes, fitting, zooming, hit testing, link paths, label placement); this file
// draws it. Every node is a circle in its type's colour with the type's icon
// inside (type-style.ts), the same icon the table and the drawer show. A
// relation is a solid line with an arrow towards its target, labelled with its
// type (`member of`, `led to`) when its memory is in focus, or every one when
// the graph is small or zoomed in; a mention is a dashed line. When two
// memories link both ways, the two lines bend apart, each label on its side.
//
// Interaction: hovering shows a tooltip and lights the node's neighbours; a
// click selects a node, a second click (or a click on the background) clears.
// The wheel (or only a pinch, with `scrollZoom` off) and the + / − buttons zoom
// about the cursor or the centre, dragging the background pans, and dragging a
// node moves it and pins it there (a dot marks it); double-clicking a pinned
// node releases it, and Release releases them all. With a `pinKey`, pins
// survive the graph being unmounted (switching tabs) for as long as the page
// is loaded. Colours follow the host's light or dark theme through its CSS
// variables.
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import {
  EDGE_LABEL_HEIGHT,
  arrowHead,
  clip,
  edgeAt,
  edgePath,
  fitView,
  labelBox,
  layoutGraph,
  nodeAt,
  placeEdgeLabels,
  placeLabels,
  toLayout,
  zoomView,
  type EdgePath,
  type PlacedLabel,
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

const FONT_STACK = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const LABEL_FONT = `11px ${FONT_STACK}`;
const EDGE_LABEL_FONT = `10px ${FONT_STACK}`;
/**
 * Unfocused, a graph this small labels every node and relation; a larger one
 * only nodes with LABEL_MIN_DEGREE links, and no relation.
 */
const LABEL_ALL_UP_TO = 20;
const LABEL_MIN_DEGREE = 5;
/** Zoomed in this far past the fitted view, every node and relation gets a label. */
const LABEL_ALL_ZOOM = 1.8;
/** A relation type longer than this is cut on the canvas. */
const EDGE_LABEL_MAX = 28;
/** How far, in pixels, the lines of two memories linked both ways bend apart. */
const BEND = 10;
/** A relation's arrowhead, in pixels. */
const ARROW_LENGTH = 7;
const ARROW_WIDTH = 6;
/** Pointer travel, in pixels, that turns a press into a drag. */
const DRAG_SLOP = 4;
const ZOOM_STEP = 1.3;
/** Below this height the zoom buttons are one row, in a strip the fitted drawing keeps clear of. */
const COMPACT_HEIGHT = 360;
/** Height of that strip, in pixels. */
const CONTROL_STRIP = 40;
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
  /** The zoom buttons (+, −, fit). Default true. */
  controls?: boolean;
  /**
   * The wheel zooms. Default true. Off, for a graph inside a scrolling panel,
   * the wheel scrolls the panel and only a pinch (or Ctrl or ⌘ with the wheel)
   * zooms.
   */
  scrollZoom?: boolean;
  /** Keep pinned nodes under this key across mounts; without one, pins live as long as the graph. */
  pinKey?: string;
  /** The legend of types under the canvas. Default true. */
  legend?: boolean;
}

/** A link as drawn: its path, and whether it touches the focus or is faded out. */
interface DrawnEdge {
  edge: GraphEdge;
  key: string;
  path: EdgePath;
  touches: boolean;
  faded: boolean;
}

const edgeKey = (edge: GraphEdge) => `${edge.source}\u0000${edge.target}`;

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
  scrollZoom = true,
  pinKey,
  legend = true,
}: GraphViewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  // The hovered node; changing it redraws without a render.
  const hoverRef = useRef<string | null>(null);
  // The hovered link (`source\u0000target`), when no node is hovered; changing it redraws too.
  const hoverEdgeRef = useRef<string | null>(null);
  // The links as last drawn, to find the one under the pointer.
  const drawnEdgesRef = useRef<DrawnEdge[]>([]);
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
  // On a short canvas the zoom buttons sit in a strip along the bottom, which the fitted drawing keeps clear of.
  const compact = controls && canvasHeight < COMPACT_HEIGHT;
  const fitHeight = compact ? canvasHeight - CONTROL_STRIP : canvasHeight;
  const fit = useMemo(() => fitView(points, width, fitHeight), [points, width, fitHeight]);
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

    // Links: rim to rim, bent apart when the link back is drawn too; a relation ends in an arrow.
    const linked = new Set(shown.map(edgeKey));
    const paths: DrawnEdge[] = [];
    const pointed = hover === null ? hoverEdgeRef.current : null;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const e of shown) {
      const relation = e.type === "relation";
      const a = at.get(e.source)!;
      const b = at.get(e.target)!;
      // An arrow's tip stops just outside the target's ring.
      const path = edgePath(
        a,
        relation ? { ...b, r: b.r + 1.5 } : b,
        linked.has(edgeKey({ ...e, source: e.target, target: e.source })) ? BEND : 0,
      );
      if (path === null) continue;
      const normal = relation ? 0.5 : 0.35;
      const touches = focus !== null && (e.source === focus || e.target === focus);
      const faded =
        focus !== null
          ? !touches
          : highlight !== null && !highlight.has(e.source) && !highlight.has(e.target);
      const key = edgeKey(e);
      paths.push({ edge: e, key, path, touches, faded });
      const strong = touches || key === pointed;
      ctx.globalAlpha = faded ? 0.06 : strong ? 0.9 : normal;
      const color = touches
        ? typeColor(byName.get(focus!)!.type, theme.dark)
        : key === pointed
          ? theme.fg
          : theme.muted;
      ctx.strokeStyle = color;
      ctx.lineWidth = (relation ? 1.5 : 1) * (strong ? 1.4 : 1);
      ctx.setLineDash(relation ? [] : [4, 3]);
      const arrow = strong ? 1.2 : 1;
      // A relation's line stops inside its arrowhead, so the round cap never shows past the tip.
      const inset = relation ? ARROW_LENGTH * arrow * 0.6 : 0;
      ctx.beginPath();
      ctx.moveTo(path.x1, path.y1);
      if (path.control === null) {
        ctx.lineTo(path.x2 - path.ux * inset, path.y2 - path.uy * inset);
      } else {
        ctx.quadraticCurveTo(
          path.control.x,
          path.control.y,
          path.x2 - path.ux * inset,
          path.y2 - path.uy * inset,
        );
      }
      ctx.stroke();
      if (relation) {
        const [tip, left, right] = arrowHead(path, ARROW_LENGTH * arrow, ARROW_WIDTH * arrow);
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      }
    }
    ctx.setLineDash([]);
    drawnEdgesRef.current = paths;

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

    // Labels, each placed where nothing drawn before it is: node names (the focus first, then by
    // link count) and relation types on their links (the focus's and the hovered link's, else every
    // one in a small or zoomed-in graph; mentions have none). With a focus, its relation types come
    // right after its name, before the other names, which take the free side of their node or give
    // way; without one, the names come before the relation types.
    ctx.globalAlpha = 1;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const labelAll = zoom >= LABEL_ALL_ZOOM || drawn.length <= LABEL_ALL_UP_TO;
    const measureName = (text: string) => {
      ctx.font = LABEL_FONT;
      return ctx.measureText(text).width;
    };
    const measureType = (text: string) => {
      ctx.font = EDGE_LABEL_FONT;
      return ctx.measureText(text).width;
    };
    const nameBoxes = (placed: PlacedLabel[]) =>
      placed.map((label) => labelBox(label, measureName(label.text)));
    const names = drawn
      .filter((p) => (lit !== null ? lit.has(p.name) : labelAll || p.degree >= LABEL_MIN_DEGREE))
      .filter((p) => p.x > -40 && p.x < width + 40 && p.y > -20 && p.y < canvasHeight + 20)
      .sort(
        (a, b) =>
          Number(b.name === focus) - Number(a.name === focus) ||
          b.degree - a.degree ||
          (a.name < b.name ? -1 : 1),
      )
      .map((p) => ({ name: p.name, text: byName.get(p.name)!.label, x: p.x, y: p.y, r: p.r }));
    const typed = paths.filter(
      ({ edge, faded }) => edge.type === "relation" && edge.relation !== undefined && !faded,
    );
    const typeRequest = ({ edge, key, path }: DrawnEdge) => ({
      key,
      text: clip(edge.relation!, EDGE_LABEL_MAX),
      x: path.label.x,
      y: path.label.y,
      side: path.label.side,
      along: path.label.along,
    });
    const size = { width, height: canvasHeight };
    // Relation types may cover the nodes faded out of focus, not the ones that stand out.
    const solid = drawn.filter((p) => rank(p.name) > 0);
    const focusName = placeLabels(
      names.filter((n) => n.name === focus),
      width,
      measureName,
    );
    const firstTypes = placeEdgeLabels(
      typed
        .filter(({ key, touches }) => key === pointed || (focus !== null && touches))
        .sort((p, q) => Number(q.key === pointed) - Number(p.key === pointed))
        .map(typeRequest),
      solid,
      nameBoxes(focusName),
      size,
      measureType,
    );
    const otherNames = placeLabels(
      names.filter((n) => n.name !== focus),
      width,
      measureName,
      [...nameBoxes(focusName), ...firstTypes],
    );
    const laterTypes =
      focus === null && labelAll
        ? placeEdgeLabels(
            typed.filter(({ key }) => key !== pointed).map(typeRequest),
            solid,
            [...nameBoxes(focusName), ...firstTypes, ...nameBoxes(otherNames)],
            size,
            measureType,
          )
        : [];
    const labels = [...focusName, ...otherNames];

    const focusColor = focus === null ? theme.fg : typeColor(byName.get(focus)!.type, theme.dark);
    ctx.font = EDGE_LABEL_FONT;
    ctx.textAlign = "center";
    for (const label of [...firstTypes, ...laterTypes]) {
      const strong = focus !== null || label.key === pointed;
      ctx.beginPath();
      ctx.roundRect(label.x, label.y, label.w, label.h, EDGE_LABEL_HEIGHT / 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.surface;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.globalAlpha = strong ? 0.6 : 0.35;
      ctx.strokeStyle = strong ? focusColor : theme.muted;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = strong ? theme.fg : theme.muted;
      ctx.fillText(label.text, label.x + label.w / 2, label.y + label.h / 2 + 0.5);
    }

    ctx.font = LABEL_FONT;
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
    if (canvas === null) return;
    const onWheel = (event: WheelEvent) => {
      // A trackpad pinch arrives as the wheel with Ctrl held, in small steps.
      const pinch = event.ctrlKey || event.metaKey;
      // Without scroll zoom, the wheel scrolls whatever holds the graph.
      if (!scrollZoom && !pinch) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomRef.current(
        Math.exp(-delta * (pinch ? 0.01 : 0.0015)),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [scrollZoom]);

  function pointer(event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** What the tooltip says about the node called `name`. */
  function nodeTip(name: string): string {
    const node = byName.get(name)!;
    const degree = neighbours.get(name)?.size ?? 0;
    return `${node.label} · ${node.type} · ${degree} link${degree === 1 ? "" : "s"}${
      pins.has(name) ? " · pinned, double-click to release" : ""
    }`;
  }

  /** What the tooltip says about a link: `Ana —member of→ Core`, or `Ana mentions Core`. */
  function edgeTip(edge: GraphEdge): string {
    const from = byName.get(edge.source)?.label ?? edge.source;
    const to = byName.get(edge.target)?.label ?? edge.target;
    return edge.type === "relation" && edge.relation !== undefined
      ? `${from} —${edge.relation}→ ${to}`
      : `${from} mentions ${to}`;
  }

  function showTip(text: string | null, x: number, y: number): void {
    const tip = tipRef.current;
    if (tip === null) return;
    if (text === null) {
      tip.style.display = "none";
      return;
    }
    tip.textContent = text;
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
    // Off the nodes, the link under the pointer, among those not faded out.
    const visible = hit === null ? drawnEdgesRef.current.filter((d) => !d.faded) : [];
    const at = edgeAt(visible.map((d) => d.path), x, y);
    const edge = at < 0 ? null : visible[at]!;
    if (hit !== hoverRef.current || (edge?.key ?? null) !== hoverEdgeRef.current) {
      hoverRef.current = hit;
      hoverEdgeRef.current = edge?.key ?? null;
      draw();
    }
    showTip(hit !== null ? nodeTip(hit) : edge !== null ? edgeTip(edge.edge) : null, x, y);
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
    hoverEdgeRef.current = null;
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
          <div
            role="group"
            aria-label="Zoom"
            className={cn(
              "absolute z-[3] flex items-stretch overflow-hidden rounded-[8px] border border-border bg-popover text-popover-foreground shadow-sm",
              compact ? "bottom-2 right-2 flex-row" : "bottom-3 right-3 flex-col",
            )}
          >
            {compact ? (
              <ZoomButton label="Zoom out" icon={GLYPH.minus} onClick={() => zoomBy(1 / ZOOM_STEP)} small />
            ) : (
              <ZoomButton label="Zoom in" icon={GLYPH.plus} onClick={() => zoomBy(ZOOM_STEP)} />
            )}
            <span
              aria-live="polite"
              className={cn(
                "text-center text-[10px] tabular-nums text-muted-foreground",
                compact ? "flex min-w-9 items-center justify-center px-1" : "px-1 py-0.5",
              )}
            >
              {Math.round(zoom * 100)}%
            </span>
            {compact ? (
              <ZoomButton label="Zoom in" icon={GLYPH.plus} onClick={() => zoomBy(ZOOM_STEP)} small />
            ) : (
              <ZoomButton label="Zoom out" icon={GLYPH.minus} onClick={() => zoomBy(1 / ZOOM_STEP)} />
            )}
            <span className={compact ? "w-px bg-border" : "h-px bg-border"} />
            <ZoomButton label="Fit to screen" icon={GLYPH.fit} onClick={() => setCamera(null)} small={compact} />
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

function ZoomButton({
  label,
  icon,
  onClick,
  small = false,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  /** The one-row buttons of a short canvas. */
  small?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center text-foreground transition-colors hover:bg-accent",
        small ? "size-7" : "size-8",
        FOCUS_RING,
      )}
    >
      <svg
        aria-hidden
        width={small ? 14 : 16}
        height={small ? 14 : 16}
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

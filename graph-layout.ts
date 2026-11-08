// The geometry of the memory graph, which pages/GraphView.tsx draws: a force
// layout, fitting it into the canvas, hit testing and label placement. Pure
// and browser-safe.

export interface LayoutPoint {
  name: string;
  /** Layout units; a View maps them to canvas pixels. */
  x: number;
  y: number;
  /** Links in or out among the links laid out. */
  degree: number;
  /** Drawn radius, in pixels. */
  r: number;
}

/** Canvas pixel = layout unit × scale + offset. */
export interface View {
  scale: number;
  ox: number;
  oy: number;
}

/** Iterations of the force simulation. */
const STEPS = 700;
/** Length a link pulls its two nodes towards. */
const LINK_LENGTH = 62;
/** Gap between the farthest linked node and the ring of unconnected ones. */
export const RING_GAP = 45;
/** Canvas margin around the drawing, in pixels. */
const PAD = 28;
/** Most pixels per layout unit, so a handful of nodes does not fill the whole canvas. */
export const MAX_SCALE = 2.5;

/** Drawn radius of a node with `degree` links. */
export function nodeRadius(degree: number): number {
  return 4 + Math.sqrt(degree) * 1.4;
}

interface Body {
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * Positions for `names`, returned in the same order. Nodes with a link get a
 * force layout (repulsion between every pair, links pulling towards
 * LINK_LENGTH, a weak pull to the centre); nodes without one sit evenly on a
 * ring RING_GAP outside the farthest linked node, in name order, clockwise
 * from the top. Links naming an unknown node, and self links, are ignored.
 * Deterministic, whatever the order of `names` and `links`.
 *
 * `aspect` (width / height of the canvas it will be drawn on) stretches the
 * drawing to that shape: the pull to the centre is weaker sideways, and the
 * ring of unconnected nodes becomes an ellipse. `collide`, a gap in layout
 * units, keeps linked nodes at least their radii plus that gap apart, so a
 * dense cluster spreads out instead of piling up.
 */
export interface LayoutOptions {
  aspect?: number;
  collide?: number;
}

export function layoutGraph(
  names: readonly string[],
  links: ReadonlyArray<readonly [string, string]>,
  { aspect = 1, collide = 0 }: LayoutOptions = {},
): LayoutPoint[] {
  const bodies: Body[] = names
    .map((name) => ({ name, x: 0, y: 0, vx: 0, vy: 0, degree: 0 }))
    .sort(byName);
  const index = new Map(bodies.map((body, i) => [body.name, i]));
  const pairs: Array<[number, number]> = [];
  for (const [source, target] of links) {
    const a = index.get(source);
    const b = index.get(target);
    if (a === undefined || b === undefined || a === b) continue;
    pairs.push([a, b]);
    bodies[a]!.degree += 1;
    bodies[b]!.degree += 1;
  }
  pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);

  const linked = bodies.filter((body) => body.degree > 0);
  const lonely = bodies.filter((body) => body.degree === 0);
  const n = linked.length;
  const golden = Math.PI * (3 - Math.sqrt(5));
  linked.forEach((body, i) => {
    const radius = 14 * Math.sqrt(i + 1);
    body.x = Math.cos(i * golden) * radius * aspect;
    body.y = Math.sin(i * golden) * radius;
  });
  for (let step = 0; step < STEPS; step++) {
    const heat = 1 - step / STEPS;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = linked[i]!;
        const b = linked[j]!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = 0.1;
          dy = (i - j) * 0.01;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        let force = Math.min(2600 / d2, 40) * heat;
        if (collide > 0) {
          const min = nodeRadius(a.degree) + nodeRadius(b.degree) + collide;
          if (d < min) force += (min - d) * 0.5;
        }
        a.vx += (dx / d) * force;
        a.vy += (dy / d) * force;
        b.vx -= (dx / d) * force;
        b.vy -= (dy / d) * force;
      }
    }
    for (const [s, t] of pairs) {
      const a = bodies[s]!;
      const b = bodies[t]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (d - LINK_LENGTH) * 0.03 * heat;
      a.vx += (dx / d) * force;
      a.vy += (dy / d) * force;
      b.vx -= (dx / d) * force;
      b.vy -= (dy / d) * force;
    }
    for (const body of linked) {
      body.vx = (body.vx - (body.x * 0.004 * heat) / (aspect * aspect)) * 0.55;
      body.vy = (body.vy - body.y * 0.004 * heat) * 0.55;
      body.x += body.vx;
      body.y += body.vy;
    }
  }

  let cx = 0;
  let cy = 0;
  for (const body of linked) {
    cx += body.x / n;
    cy += body.y / n;
  }
  let reach = 0;
  for (const body of linked) reach = Math.max(reach, Math.hypot((body.x - cx) / aspect, body.y - cy));
  lonely.forEach((body, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / lonely.length;
    body.x = cx + (reach + RING_GAP) * aspect * Math.cos(angle);
    body.y = cy + (reach + RING_GAP) * Math.sin(angle);
  });

  const placed = new Map(bodies.map((body) => [body.name, body]));
  return names.map((name) => {
    const body = placed.get(name)!;
    return { name, x: body.x, y: body.y, degree: body.degree, r: nodeRadius(body.degree) };
  });
}

/** The view that fits `points` into a `width` × `height` canvas, centred, inside a PAD margin. */
export function fitView(
  points: ReadonlyArray<{ x: number; y: number }>,
  width: number,
  height: number,
): View {
  if (points.length === 0) return { scale: 1, ox: width / 2, oy: height / 2 };
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const w = Math.max(width - 2 * PAD, 1);
  const h = Math.max(height - 2 * PAD, 1);
  const scale = Math.min(w / Math.max(x1 - x0, 1), h / Math.max(y1 - y0, 1), MAX_SCALE);
  return {
    scale,
    ox: PAD + (w - (x1 - x0) * scale) / 2 - x0 * scale,
    oy: PAD + (h - (y1 - y0) * scale) / 2 - y0 * scale,
  };
}

/** The node drawn nearest to canvas point (`x`, `y`), within its radius plus 6px; else null. */
export function nodeAt(
  points: readonly LayoutPoint[],
  view: View,
  x: number,
  y: number,
): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const p of points) {
    const d = Math.hypot(p.x * view.scale + view.ox - x, p.y * view.scale + view.oy - y);
    if (d < p.r + 6 && d < bestDistance) {
      best = p.name;
      bestDistance = d;
    }
  }
  return best;
}

/** A label wanted next to a node drawn at (`x`, `y`) with radius `r`, in canvas pixels. */
export interface LabelRequest {
  name: string;
  text: string;
  x: number;
  y: number;
  r: number;
}

/** Where to draw a label: `align` is the canvas textAlign at (`x`, `y`). */
export interface PlacedLabel {
  name: string;
  text: string;
  x: number;
  y: number;
  align: "left" | "right";
}

/** A rectangle in canvas pixels, from its top left corner. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** True when `a` and `b` come closer than `gap` pixels sideways (they may touch vertically). */
function boxesOverlap(a: Box, b: Box, gap = 2): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** True when the circle at (`x`, `y`) with radius `r` reaches into `box`. */
function circleTouchesBox(circle: { x: number; y: number; r: number }, box: Box): boolean {
  const nx = Math.max(box.x, Math.min(circle.x, box.x + box.w));
  const ny = Math.max(box.y, Math.min(circle.y, box.y + box.h));
  return Math.hypot(circle.x - nx, circle.y - ny) < circle.r;
}

/** The box a node label `w` pixels wide covers, as placeLabels placed it. */
export function labelBox(label: PlacedLabel, w: number): Box {
  return { x: label.align === "left" ? label.x : label.x - w, y: label.y - 7, w, h: 14 };
}

/**
 * Labels in request order (the first wins a collision): right of the node,
 * else left of it, when the right side would pass the canvas edge or overlap
 * a label already placed or a box in `taken`; a label with no free side is
 * skipped.
 */
export function placeLabels(
  requests: readonly LabelRequest[],
  width: number,
  measure: (text: string) => number,
  taken: readonly Box[] = [],
): PlacedLabel[] {
  const boxes: Box[] = [...taken];
  const placed: PlacedLabel[] = [];
  for (const request of requests) {
    const w = measure(request.text);
    const sides: Array<"right" | "left"> =
      request.x + request.r + 4 + w < width - 4 ? ["right", "left"] : ["left"];
    for (const side of sides) {
      const label: PlacedLabel = {
        name: request.name,
        text: request.text,
        x: side === "right" ? request.x + request.r + 4 : request.x - request.r - 4,
        y: request.y,
        align: side === "right" ? "left" : "right",
      };
      const box = labelBox(label, w);
      if (boxes.some((other) => boxesOverlap(box, other))) continue;
      boxes.push(box);
      placed.push(label);
      break;
    }
  }
  return placed;
}

// ---- links ---------------------------------------------------------------------

/** A node as drawn: its centre and radius, in canvas pixels. */
export interface DrawnNode {
  x: number;
  y: number;
  r: number;
}

/**
 * A link as drawn from one node's rim to the other's: a straight line, or a
 * quadratic curve through (`cx`, `cy`) that bends to one side.
 */
export interface EdgePath {
  /** Start, on the source node's rim. */
  x1: number;
  y1: number;
  /** End, on the target node's rim: where an arrow's tip goes. */
  x2: number;
  y2: number;
  /** The curve's control point; null for a straight line. */
  control: { x: number; y: number } | null;
  /** Unit direction of the path where it reaches the target. */
  ux: number;
  uy: number;
  /**
   * Where the path's label goes: the middle of a straight line, which the
   * label covers; for a curve, the middle of the straight way between the
   * nodes, and `side`, the unit vector towards the curve: its label is pushed
   * off that way, so the label of the link back lands on the other side.
   * `along` runs from that point to the end of the stretch between the rims,
   * for a label that has to slide along the link to find room.
   */
  label: {
    x: number;
    y: number;
    side: { x: number; y: number } | null;
    along: { x: number; y: number };
  };
}

/**
 * The path of a link from `a` to `b`, rim to rim. With `bend` it curves about
 * that many pixels (at its middle) to the left of the way from `a` to `b`, so
 * the link back from `b` to `a`, bent by the same amount, curves to the other
 * side and the two never cover each other. Null when the nodes overlap:
 * nothing shows between them.
 */
export function edgePath(a: DrawnNode, b: DrawnNode, bend = 0): EdgePath | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d <= a.r + b.r) return null;
  const ux = dx / d;
  const uy = dy / d;
  if (bend === 0) {
    const x1 = a.x + ux * a.r;
    const y1 = a.y + uy * a.r;
    const x2 = b.x - ux * b.r;
    const y2 = b.y - uy * b.r;
    return {
      x1,
      y1,
      x2,
      y2,
      control: null,
      ux,
      uy,
      label: { x: (x1 + x2) / 2, y: (y1 + y2) / 2, side: null, along: { x: (x2 - x1) / 2, y: (y2 - y1) / 2 } },
    };
  }
  // Left of the way from a to b, on a canvas whose y axis points down.
  const side = { x: uy, y: -ux };
  // A quadratic curve passes halfway between the chord and its control point.
  const control = { x: a.x + dx / 2 + side.x * bend * 2, y: a.y + dy / 2 + side.y * bend * 2 };
  const toward = (from: DrawnNode) => {
    const vx = control.x - from.x;
    const vy = control.y - from.y;
    const v = Math.hypot(vx, vy) || 1;
    return { x: from.x + (vx / v) * from.r, y: from.y + (vy / v) * from.r };
  };
  const start = toward(a);
  const end = toward(b);
  const ex = end.x - control.x;
  const ey = end.y - control.y;
  const e = Math.hypot(ex, ey) || 1;
  return {
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    control,
    ux: ex / e,
    uy: ey / e,
    label: {
      x: a.x + dx / 2,
      y: a.y + dy / 2,
      side,
      along: { x: (end.x - start.x) / 2, y: (end.y - start.y) / 2 },
    },
  };
}

/** The three corners of an arrowhead `length` long and `width` wide whose tip is at the path's end. */
export function arrowHead(
  path: EdgePath,
  length: number,
  width: number,
): [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }] {
  const bx = path.x2 - path.ux * length;
  const by = path.y2 - path.uy * length;
  const half = width / 2;
  return [
    { x: path.x2, y: path.y2 },
    { x: bx + path.uy * half, y: by - path.ux * half },
    { x: bx - path.uy * half, y: by + path.ux * half },
  ];
}

/** A label wanted at the middle of a link, in canvas pixels: EdgePath's `label` with its text. */
export interface EdgeLabelRequest {
  key: string;
  text: string;
  x: number;
  y: number;
  /** Push the label off (`x`, `y`) this way until it clears that point; null centres it there. */
  side: { x: number; y: number } | null;
  /** Where the label may slide when its place is taken: up to half this far either way. */
  along?: { x: number; y: number };
}

/** Where a link label tries to go, as fractions of `along`: the middle first, then either way. */
const SLIDES = [0, -0.3, 0.3, -0.55, 0.55];

/** Where to draw a link's label: its box, the text centred in it. */
export interface PlacedEdgeLabel extends Box {
  key: string;
  text: string;
}

/** Height of a link label's box, in pixels. */
export const EDGE_LABEL_HEIGHT = 14;
/** Room either side of a link label's text, in pixels. */
const EDGE_LABEL_PAD = 4;

/**
 * Link labels in request order (the first wins a collision), each a box
 * centred on its point, or pushed off it to its `side` with a 2px gap. A
 * label may not leave the canvas, reach into a node (`nodes`, with their
 * drawn radii), or overlap a box in `taken` (the nodes' labels) or a link
 * label already placed: it slides along its link (`along`) to the first free
 * place, and is skipped when there is none.
 */
export function placeEdgeLabels(
  requests: readonly EdgeLabelRequest[],
  nodes: readonly DrawnNode[],
  taken: readonly Box[],
  size: { width: number; height: number },
  measure: (text: string) => number,
): PlacedEdgeLabel[] {
  const boxes: Box[] = [...taken];
  const placed: PlacedEdgeLabel[] = [];
  for (const request of requests) {
    const w = measure(request.text) + 2 * EDGE_LABEL_PAD;
    const h = EDGE_LABEL_HEIGHT;
    // How far the box's centre must move along `side` for the box to clear the point.
    const push =
      request.side === null
        ? 0
        : (Math.abs(request.side.x) * w) / 2 + (Math.abs(request.side.y) * h) / 2 + 2;
    const free = (box: Box) =>
      box.x >= 2 &&
      box.y >= 2 &&
      box.x + box.w <= size.width - 2 &&
      box.y + box.h <= size.height - 2 &&
      !nodes.some((node) => circleTouchesBox({ ...node, r: node.r + 2 }, box)) &&
      !boxes.some((other) => boxesOverlap(box, other));
    for (const slide of request.along === undefined ? [0] : SLIDES) {
      const cx = request.x + (request.along?.x ?? 0) * slide + (request.side?.x ?? 0) * push;
      const cy = request.y + (request.along?.y ?? 0) * slide + (request.side?.y ?? 0) * push;
      const box = { x: cx - w / 2, y: cy - h / 2, w, h };
      if (!free(box)) continue;
      boxes.push(box);
      placed.push({ key: request.key, text: request.text, ...box });
      break;
    }
  }
  return placed;
}

/** Distance from (`x`, `y`) to the segment from (`x1`, `y1`) to (`x2`, `y2`). */
function distanceToSegment(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length2));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/** Distance from (`x`, `y`) to a path: exact for a line, along 16 chords for a curve. */
function distanceToPath(path: EdgePath, x: number, y: number): number {
  if (path.control === null) return distanceToSegment(x, y, path.x1, path.y1, path.x2, path.y2);
  const { control } = path;
  const at = (t: number) => ({
    x: (1 - t) * (1 - t) * path.x1 + 2 * (1 - t) * t * control.x + t * t * path.x2,
    y: (1 - t) * (1 - t) * path.y1 + 2 * (1 - t) * t * control.y + t * t * path.y2,
  });
  let best = Infinity;
  let previous = at(0);
  for (let step = 1; step <= 16; step++) {
    const next = at(step / 16);
    best = Math.min(best, distanceToSegment(x, y, previous.x, previous.y, next.x, next.y));
    previous = next;
  }
  return best;
}

/** The index of the path passing nearest to canvas point (`x`, `y`), within `tolerance` pixels; else -1. */
export function edgeAt(paths: readonly EdgePath[], x: number, y: number, tolerance = 5): number {
  let best = -1;
  let bestDistance = tolerance;
  paths.forEach((path, index) => {
    const d = distanceToPath(path, x, y);
    if (d <= bestDistance) {
      best = index;
      bestDistance = d;
    }
  });
  return best;
}

/** `text` cut to `max` characters, an ellipsis marking the cut. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

// ---- camera ------------------------------------------------------------------

/** How far the user may zoom out of, and into, the fitted view. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 6;

/**
 * `view` zoomed by `factor` about canvas point (`cx`, `cy`), which stays put;
 * the scale is kept between `fit.scale` × ZOOM_MIN and × ZOOM_MAX.
 */
export function zoomView(view: View, fit: View, factor: number, cx: number, cy: number): View {
  const scale = Math.min(
    fit.scale * ZOOM_MAX,
    Math.max(fit.scale * ZOOM_MIN, view.scale * factor),
  );
  const f = scale / view.scale;
  return { scale, ox: cx - (cx - view.ox) * f, oy: cy - (cy - view.oy) * f };
}

/** The layout point under canvas point (`x`, `y`). */
export function toLayout(view: View, x: number, y: number): { x: number; y: number } {
  return { x: (x - view.ox) / view.scale, y: (y - view.oy) / view.scale };
}

/** A point on the canvas, in pixels. */
export interface Point {
  x: number;
  y: number;
}

/**
 * The view during a two-finger pinch. `start` was the view when the fingers
 * touched down at `a0` and `b0`; they are now at `a1` and `b1`. The scale
 * grows or shrinks with the distance between the fingers (kept between
 * `fit.scale` × ZOOM_MIN and × ZOOM_MAX), and what was between the fingers
 * at the start stays between them, so spreading zooms in on that spot and
 * moving both fingers pans.
 */
export function pinchView(start: View, fit: View, a0: Point, b0: Point, a1: Point, b1: Point): View {
  const before = Math.max(Math.hypot(b0.x - a0.x, b0.y - a0.y), 1);
  const after = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const scale = Math.min(
    fit.scale * ZOOM_MAX,
    Math.max(fit.scale * ZOOM_MIN, start.scale * (after / before)),
  );
  const held = toLayout(start, (a0.x + b0.x) / 2, (a0.y + b0.y) / 2);
  return {
    scale,
    ox: (a1.x + b1.x) / 2 - held.x * scale,
    oy: (a1.y + b1.y) / 2 - held.y * scale,
  };
}

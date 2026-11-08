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

/**
 * Labels in request order (the first wins a collision): right of the node,
 * or left of it when the right side would pass the canvas edge; a label whose
 * box would overlap one already placed is skipped.
 */
export function placeLabels(
  requests: readonly LabelRequest[],
  width: number,
  measure: (text: string) => number,
): PlacedLabel[] {
  const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  const placed: PlacedLabel[] = [];
  for (const request of requests) {
    const w = measure(request.text);
    const right = request.x + request.r + 4 + w < width - 4;
    const lx = right ? request.x + request.r + 4 : request.x - request.r - 4;
    const box = { x: right ? lx : lx - w, y: request.y - 7, w, h: 14 };
    const overlaps = boxes.some(
      (other) =>
        box.x < other.x + other.w + 2 &&
        other.x < box.x + box.w + 2 &&
        box.y < other.y + other.h &&
        other.y < box.y + box.h,
    );
    if (overlaps) continue;
    boxes.push(box);
    placed.push({
      name: request.name,
      text: request.text,
      x: lx,
      y: request.y,
      align: right ? "left" : "right",
    });
  }
  return placed;
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

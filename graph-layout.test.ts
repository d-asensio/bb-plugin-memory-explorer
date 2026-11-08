import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  MAX_SCALE,
  ZOOM_MAX,
  ZOOM_MIN,
  arrowHead,
  clip,
  edgeAt,
  edgePath,
  labelBox,
  placeEdgeLabels,
  toLayout,
  zoomView,
  RING_GAP,
  fitView,
  layoutGraph,
  nodeAt,
  nodeRadius,
  placeLabels,
  type LayoutPoint,
} from "./graph-layout.js";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

test("layoutGraph: unconnected nodes sit on a ring outside the linked ones, from the top", () => {
  const points = layoutGraph(["a", "b", "c", "x", "y"], [["a", "b"], ["b", "c"]]);
  const at = new Map(points.map((p) => [p.name, p]));
  const linked = ["a", "b", "c"].map((name) => at.get(name)!);
  const cx = linked.reduce((sum, p) => sum + p.x, 0) / linked.length;
  const cy = linked.reduce((sum, p) => sum + p.y, 0) / linked.length;
  const reach = Math.max(...linked.map((p) => Math.hypot(p.x - cx, p.y - cy)));
  const x = at.get("x")!;
  const y = at.get("y")!;
  assert.ok(close(Math.hypot(x.x - cx, x.y - cy), reach + RING_GAP));
  assert.ok(close(Math.hypot(y.x - cx, y.y - cy), reach + RING_GAP));
  // In name order, clockwise from the top: x above the centre, y below it.
  assert.ok(close(x.x, cx) && x.y < cy);
  assert.ok(close(y.x, cx) && y.y > cy);
});

test("layoutGraph: degree and radius count each link; unknown names and self links are ignored", () => {
  const points = layoutGraph(
    ["a", "b", "c"],
    [["a", "b"], ["b", "a"], ["a", "a"], ["a", "zz"]],
  );
  assert.deepEqual(
    points.map((p) => [p.name, p.degree]),
    [["a", 2], ["b", 2], ["c", 0]],
  );
  assert.equal(points[0]!.r, nodeRadius(2));
  assert.equal(nodeRadius(0), 4);
});

test("layoutGraph: the same graph in another order gets the same positions", () => {
  const one = layoutGraph(["a", "b", "c", "d"], [["a", "b"], ["c", "b"], ["d", "a"]]);
  const two = layoutGraph(["d", "c", "b", "a"], [["d", "a"], ["c", "b"], ["a", "b"]]);
  const positions = (points: LayoutPoint[]) =>
    Object.fromEntries(points.map((p) => [p.name, [p.x, p.y]]));
  assert.deepEqual(positions(two), positions(one));
});

test("layoutGraph: linked nodes spread out, every position finite", () => {
  const names = Array.from({ length: 30 }, (_, i) => `n${String(i).padStart(2, "0")}`);
  const chain = names.slice(1).map((name, i) => [names[i]!, name] as const);
  const points = layoutGraph(names, chain);
  for (const p of points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), p.name);
  let nearest = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      nearest = Math.min(nearest, Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y));
    }
  }
  assert.ok(nearest > 10, `two nodes ${nearest} apart`);
});

test("fitView: centres the drawing inside a 28px margin and keeps its proportions", () => {
  const view = fitView([{ x: -50, y: 0 }, { x: 50, y: 20 }], 256, 156);
  assert.equal(view.scale, 2);
  assert.equal(-50 * view.scale + view.ox, 28);
  assert.equal(50 * view.scale + view.ox, 228);
  // 40px tall, centred in the 100px between the margins.
  assert.equal(0 * view.scale + view.oy, 58);
  assert.equal(20 * view.scale + view.oy, 98);
});

test("fitView: a small drawing grows at most MAX_SCALE and stays centred", () => {
  const view = fitView([{ x: 0, y: 0 }, { x: 10, y: 0 }], 256, 156);
  assert.equal(view.scale, MAX_SCALE);
  assert.equal(5 * view.scale + view.ox, 128);
  assert.equal(0 * view.scale + view.oy, 78);
});

test("fitView: no points still gives a finite view", () => {
  const view = fitView([], 200, 100);
  assert.ok([view.scale, view.ox, view.oy].every(Number.isFinite));
});

test("nodeAt: the nearest node within its radius plus 6px, else null", () => {
  const points: LayoutPoint[] = [
    { name: "a", x: 0, y: 0, degree: 0, r: 4 },
    { name: "b", x: 10, y: 0, degree: 0, r: 4 },
  ];
  const view = { scale: 1, ox: 0, oy: 0 };
  assert.equal(nodeAt(points, view, 1, 0), "a");
  assert.equal(nodeAt(points, view, 7, 0), "b");
  assert.equal(nodeAt(points, view, -9.9, 0), "a");
  assert.equal(nodeAt(points, view, -10.1, 0), null);
  assert.equal(nodeAt(points, view, 5, 30), null);
  // Positions are layout units: the view maps them to the canvas.
  assert.equal(nodeAt(points, { scale: 2, ox: 100, oy: 50 }, 120, 50), "b");
});

test("placeLabels: right of the node, flipped left at the right edge or when the right is taken", () => {
  const measure = (text: string) => text.length * 6;
  const labels = placeLabels(
    [
      { name: "a", text: "Alpha", x: 50, y: 50, r: 4 },
      // Its right would cover Alpha's label: drawn on the left.
      { name: "b", text: "Beta", x: 52, y: 55, r: 4 },
      // No room on the right before the edge: drawn on the left.
      { name: "c", text: "Gamma", x: 190, y: 50, r: 4 },
      // Alpha's label on the right, Beta's on the left: skipped.
      { name: "d", text: "Delta", x: 52, y: 52, r: 4 },
    ],
    200,
    measure,
  );
  assert.deepEqual(labels, [
    { name: "a", text: "Alpha", x: 58, y: 50, align: "left" },
    { name: "b", text: "Beta", x: 44, y: 55, align: "right" },
    { name: "c", text: "Gamma", x: 182, y: 50, align: "right" },
  ]);
});

test("placeLabels: a taken box counts as a label already placed", () => {
  const measure = (text: string) => text.length * 6;
  const taken = [{ x: 55, y: 40, w: 60, h: 20 }];
  assert.deepEqual(placeLabels([{ name: "a", text: "Alpha", x: 50, y: 50, r: 4 }], 200, measure, taken), [
    { name: "a", text: "Alpha", x: 42, y: 50, align: "right" },
  ]);
});

test("zoomView: the point under the cursor stays put", () => {
  const fit = { scale: 1, ox: 10, oy: 20 };
  const zoomed = zoomView(fit, fit, 2, 100, 50);
  assert.equal(zoomed.scale, 2);
  const before = toLayout(fit, 100, 50);
  const after = toLayout(zoomed, 100, 50);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
});

test("zoomView: scale stays between ZOOM_MIN and ZOOM_MAX of the fitted view", () => {
  const fit = { scale: 2, ox: 0, oy: 0 };
  assert.equal(zoomView(fit, fit, 100, 0, 0).scale, 2 * ZOOM_MAX);
  assert.equal(zoomView(fit, fit, 0.001, 0, 0).scale, 2 * ZOOM_MIN);
});

function ring(n: number): { names: string[]; links: Array<[string, string]> } {
  const names = Array.from({ length: n }, (_, i) => `n${i}`);
  const links = names.map((name, i): [string, string] => [name, names[(i + 1) % n]!]);
  // A hub linked to everyone makes a dense centre.
  for (const name of names.slice(1)) links.push(["n0", name]);
  return { names, links };
}

test("layoutGraph: aspect stretches the drawing sideways", () => {
  // Thirty separate pairs: only the pull to the centre holds them together.
  const names = Array.from({ length: 60 }, (_, i) => `n${String(i).padStart(2, "0")}`);
  const links = Array.from({ length: 30 }, (_, i): [string, string] => [names[2 * i]!, names[2 * i + 1]!]);
  const spread = (points: LayoutPoint[]) => {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
  };
  assert.ok(spread(layoutGraph(names, links, { aspect: 2 })) > spread(layoutGraph(names, links)) * 1.3);
});

test("layoutGraph: collide keeps linked nodes their radii plus the gap apart", () => {
  const { names, links } = ring(30);
  const points = layoutGraph(names, links, { collide: 30 });
  let closest = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!;
      const b = points[j]!;
      closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r);
    }
  }
  assert.ok(closest > 20, `closest gap ${closest}`);
});

test("edgePath: a straight link runs rim to rim, its label at the middle", () => {
  const path = edgePath({ x: 0, y: 0, r: 10 }, { x: 100, y: 0, r: 20 });
  assert.ok(path);
  assert.deepEqual([path.x1, path.y1, path.x2, path.y2], [10, 0, 80, 0]);
  assert.equal(path.control, null);
  assert.deepEqual([path.ux, path.uy], [1, 0]);
  assert.deepEqual(path.label, { x: 45, y: 0, side: null, along: { x: 35, y: 0 } });
});

test("edgePath: overlapping nodes have no path", () => {
  assert.equal(edgePath({ x: 0, y: 0, r: 10 }, { x: 15, y: 0, r: 10 }), null);
});

test("edgePath: a link and the link back bend to opposite sides", () => {
  const a = { x: 0, y: 0, r: 10 };
  const b = { x: 100, y: 0, r: 10 };
  const there = edgePath(a, b, 12)!;
  const back = edgePath(b, a, 12)!;
  // Going right on a canvas whose y axis points down, the left is up.
  assert.ok(there.control !== null && there.control.y < 0);
  assert.ok(back.control !== null && back.control.y > 0);
  assert.deepEqual(there.label.side, { x: 0, y: -1 });
  assert.deepEqual(back.label.side, { x: 0, y: 1 });
  // Both ends stay on the rims.
  assert.ok(close(Math.hypot(there.x1 - a.x, there.y1 - a.y), a.r));
  assert.ok(close(Math.hypot(there.x2 - b.x, there.y2 - b.y), b.r));
  // At the end, the curve heads into the target, down and to the right.
  assert.ok(there.ux > 0 && there.uy > 0);
  assert.ok(close(Math.hypot(there.ux, there.uy), 1));
});

test("arrowHead: the tip at the path's end, the base behind it, as wide as asked", () => {
  const path = edgePath({ x: 0, y: 0, r: 0 }, { x: 100, y: 0, r: 10 })!;
  const [tip, left, right] = arrowHead(path, 6, 8);
  assert.deepEqual(tip, { x: 90, y: 0 });
  assert.deepEqual([left.x, right.x], [84, 84]);
  assert.equal(Math.abs(left.y - right.y), 8);
});

test("placeEdgeLabels: centred on a straight link; skipped over a node, a taken box or another label", () => {
  const measure = (text: string) => text.length * 5;
  const size = { width: 300, height: 200 };
  const labels = placeEdgeLabels(
    [
      { key: "a", text: "owns", x: 100, y: 100, side: null },
      // Overlaps the first label.
      { key: "b", text: "uses", x: 110, y: 104, side: null },
      // On top of a node.
      { key: "c", text: "runs", x: 200, y: 50, side: null },
      // Over a node's label.
      { key: "d", text: "leads", x: 60, y: 160, side: null },
      // Past the canvas edge.
      { key: "e", text: "attends", x: 295, y: 100, side: null },
    ],
    [{ x: 200, y: 50, r: 8 }],
    [{ x: 40, y: 150, w: 60, h: 14 }],
    size,
    measure,
  );
  assert.deepEqual(labels, [{ key: "a", text: "owns", x: 86, y: 93, w: 28, h: 14 }]);
});

test("placeEdgeLabels: a pushed label clears its point on its side, so a link and the link back both fit", () => {
  const measure = (text: string) => text.length * 5;
  const labels = placeEdgeLabels(
    [
      { key: "there", text: "led to", x: 100, y: 100, side: { x: 0, y: -1 } },
      { key: "back", text: "based on", x: 100, y: 100, side: { x: 0, y: 1 } },
    ],
    [],
    [],
    { width: 300, height: 200 },
    measure,
  );
  assert.equal(labels.length, 2);
  const [there, back] = labels;
  assert.equal(there!.y + there!.h, 98);
  assert.equal(back!.y, 102);
  // Sideways the push is half the width: a vertical link's labels sit left and right of it.
  const [side] = placeEdgeLabels(
    [{ key: "x", text: "owns", x: 100, y: 100, side: { x: 1, y: 0 } }],
    [],
    [],
    { width: 300, height: 200 },
    measure,
  );
  assert.equal(side!.x, 102);
});

test("labelBox: the box a node label covers, either side of its anchor", () => {
  assert.deepEqual(labelBox({ name: "a", text: "A", x: 10, y: 20, align: "left" }, 30), {
    x: 10,
    y: 13,
    w: 30,
    h: 14,
  });
  assert.deepEqual(labelBox({ name: "a", text: "A", x: 50, y: 20, align: "right" }, 30), {
    x: 20,
    y: 13,
    w: 30,
    h: 14,
  });
});

test("clip: long text is cut with an ellipsis", () => {
  assert.equal(clip("member of", 24), "member of");
  assert.equal(clip("is the main point of contact for", 12), "is the main…");
});

test("edgeAt: the path within the tolerance, the nearest when two are", () => {
  const a = { x: 0, y: 0, r: 10 };
  const b = { x: 100, y: 0, r: 10 };
  const straight = edgePath(a, b)!;
  const there = edgePath(a, b, 12)!;
  const back = edgePath(b, a, 12)!;
  assert.equal(edgeAt([straight], 50, 3), 0);
  assert.equal(edgeAt([straight], 50, 8), -1);
  // Beyond either end of a line is not on it.
  assert.equal(edgeAt([straight], 120, 0), -1);
  // The link bent up and the link back bent down: each is found on its own side.
  assert.equal(edgeAt([there, back], 50, -12), 0);
  assert.equal(edgeAt([there, back], 50, 12), 1);
  assert.equal(edgeAt([there, back], 50, 0), -1);
});

test("placeEdgeLabels: a label whose middle is taken slides along its link to the first free place", () => {
  const measure = (text: string) => text.length * 5;
  const size = { width: 300, height: 200 };
  const request = { key: "a", text: "owns", x: 100, y: 100, side: null, along: { x: 100, y: 0 } };
  // A node sits on the middle: the label tries 30% of the way back towards the start first.
  const [slid] = placeEdgeLabels([request], [{ x: 100, y: 100, r: 6 }], [], size, measure);
  assert.equal(slid!.x + slid!.w / 2, 70);
  // Without `along` it stays put, and is skipped.
  assert.deepEqual(
    placeEdgeLabels([{ ...request, along: undefined }], [{ x: 100, y: 100, r: 6 }], [], size, measure),
    [],
  );
  // Nowhere free along the link: skipped.
  const wall = [{ x: 0, y: 90, w: 300, h: 20 }];
  assert.deepEqual(placeEdgeLabels([request], [], wall, size, measure), []);
});

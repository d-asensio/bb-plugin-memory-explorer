// Knowledge model over BB memory records, shared by the page (browser-safe,
// no Node imports): entity fields from front matter, `[[links]]` and typed
// relations, display blocks, and the link graph.
//
// An entity is a memory of kind `reference` tagged `entity` and `<type>`,
// named `<type>.<slug>`, whose details are a front-matter document followed
// by `## ` sections (for example `## Essentials`, `## Relations` and, last,
// `## Notes`). Every other memory is shown by its kind.
import { parseFrontMatter, type FrontMatterValue } from "./frontmatter.js";
import { bodyToBlocks, linkify, type Block, type Segment } from "./blocks.js";

export interface MemoryRecord {
  id: string;
  scope: "global" | "project";
  projectId: string | null;
  name: string;
  summary: string;
  details: string;
  kind: string;
  tags: string[];
  importance: number;
  pinned: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export const ENTITY_TYPES = [
  "person",
  "company",
  "team",
  "system",
  "integration",
  "meeting",
  "initiative",
  "other",
] as const;

/** The types of a memory that is not an entity: its kind. */
export const KIND_TYPES = [
  "preference",
  "decision",
  "procedure",
  "fact",
  "episode",
  "reference",
] as const;

// ---- links ---------------------------------------------------------------

const LINK_SOURCE = "\\[\\[([a-z0-9][a-z0-9._-]{0,79})(?:\\|([^\\]\\n]+))?\\]\\]";

export interface Link {
  target: string;
  label: string | null;
  index: number;
}

export interface Relation {
  type: string;
  target: string;
  label: string | null;
}

/** Every `[[target|label]]` in `text`, in order. */
export function parseLinks(text: string): Link[] {
  return [...text.matchAll(new RegExp(LINK_SOURCE, "g"))].map((m) => ({
    target: m[1]!,
    label: m[2] ?? null,
    index: m.index ?? 0,
  }));
}

/** Lines that are exactly `- <type> [[target|label]]`; any other line is skipped. */
export function parseRelations(sectionText: string): Relation[] {
  const line = new RegExp(`^\\s*[-*]\\s+(.+?)\\s+${LINK_SOURCE}\\s*$`);
  const relations: Relation[] = [];
  for (const raw of sectionText.replace(/\r\n/g, "\n").split("\n")) {
    const m = line.exec(raw);
    if (m) relations.push({ type: m[1]!, target: m[2]!, label: m[3] ?? null });
  }
  return relations;
}

/** `text` with each link replaced by its label, else its target. */
export function stripLinks(text: string): string {
  return text.replace(new RegExp(LINK_SOURCE, "g"), (_all, target, label) => label ?? target);
}

// ---- entity fields ---------------------------------------------------------

export interface EntityFields {
  id: string;
  type: string;
  name: string;
  aliases: string[];
  links: Record<string, string>;
  confidence: string;
  status?: string;
  match?: Record<string, string[]>;
}

/** `details` split into its front-matter text (or null) and the body after it. */
function splitDetails(details: string): { front: string | null; body: string } {
  const text = details.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  // Same rule as parseFrontMatter: an exact `---` line opens and closes.
  if (lines[0] !== "---") return { front: null, body: text };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { front: null, body: text };
  return {
    front: lines.slice(0, end + 1).join("\n"),
    body: lines.slice(end + 1).join("\n"),
  };
}

/** The entity type in the name prefix (`person.x` -> `person`), or null. */
function typeOfName(name: string): string | null {
  const prefix = name.slice(0, Math.max(name.indexOf("."), 0));
  return (ENTITY_TYPES as readonly string[]).includes(prefix) ? prefix : null;
}

/** True for a `reference` memory tagged `entity` whose name starts with `<type>.`. */
export function isEntity(m: MemoryRecord): boolean {
  return m.kind === "reference" && m.tags.includes("entity") && typeOfName(m.name) !== null;
}

function frontOf(m: MemoryRecord): Record<string, FrontMatterValue> | null {
  const { front } = splitDetails(m.details);
  if (front === null) return null;
  try {
    return parseFrontMatter(front);
  } catch {
    return null;
  }
}

const str = (v: FrontMatterValue | undefined): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

const list = (v: FrontMatterValue | undefined): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const isMap = (v: FrontMatterValue | undefined): v is { [key: string]: FrontMatterValue } =>
  v !== undefined && typeof v === "object" && !Array.isArray(v);

/** Entity fields from the front matter; null for a non-entity or unreadable front matter. */
export function entityFields(m: MemoryRecord): EntityFields | null {
  if (!isEntity(m)) return null;
  const front = frontOf(m);
  if (front === null) return null;
  const links: Record<string, string> = {};
  if (isMap(front.links)) {
    for (const [key, value] of Object.entries(front.links)) {
      if (typeof value === "string" && value !== "") links[key] = value;
    }
  }
  const fields: EntityFields = {
    id: str(front.id) ?? m.name,
    type: typeOfName(m.name)!,
    name: str(front.name) ?? m.name,
    aliases: list(front.aliases),
    links,
    confidence: str(front.confidence) ?? "low",
  };
  const status = str(front.status);
  if (status !== undefined) fields.status = status;
  if (isMap(front.match)) {
    fields.match = Object.fromEntries(
      Object.entries(front.match).map(([key, value]) => [key, list(value)]),
    );
  }
  return fields;
}

/** The entity type, else the memory kind. */
export function memoryType(m: MemoryRecord): string {
  return isEntity(m) ? typeOfName(m.name)! : m.kind;
}

/** The entity's `name` from its front matter, else the memory name. */
export function memoryLabel(m: MemoryRecord): string {
  return entityFields(m)?.name ?? m.name;
}

/** True when `query` (trimmed, case-insensitive) is in the name, label, an alias, email, Slack id or summary. */
export function matchesQuery(m: MemoryRecord, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return true;
  const fields = entityFields(m);
  return [
    m.name,
    fields?.name,
    ...(fields?.aliases ?? []),
    fields?.links.email,
    fields?.links.slack,
    m.summary,
  ].some((field) => field !== undefined && field.toLowerCase().includes(wanted));
}

// ---- display blocks --------------------------------------------------------

function segmentize(line: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const link of parseLinks(line)) {
    segments.push(...linkify(line.slice(last, link.index)));
    segments.push({ text: link.label ?? link.target, memory: link.target });
    last = link.index + `[[${link.target}${link.label === null ? "" : `|${link.label}`}]]`.length;
  }
  segments.push(...linkify(line.slice(last)));
  return segments;
}

/** The details body (after the front matter) as display blocks; `[[links]]` carry `memory`. */
export function detailsToBlocks(details: string): Block[] {
  return bodyToBlocks(splitDetails(details).body, segmentize);
}

// ---- Notes ---------------------------------------------------------------------
//
// Notes are the last section of an entity's details, `## Notes`: the user's
// own text about the entity. Only the page writes them; agents read them.

const NOTES_HEADING = /^## Notes[ \t]*\r?$/m;
const ANY_HEADING = /^##\s/m;

/** Where the Notes section's text starts and ends in `details`, or null. */
function notesRange(details: string): { heading: number; start: number; end: number } | null {
  const found = NOTES_HEADING.exec(details);
  if (found === null) return null;
  const lineEnd = details.indexOf("\n", found.index);
  const start = lineEnd < 0 ? details.length : lineEnd + 1;
  const next = ANY_HEADING.exec(details.slice(start));
  return { heading: found.index, start, end: next === null ? details.length : start + next.index };
}

/** The text of the `## Notes` section ('' when there is none). */
export function notesOf(details: string): string {
  const range = notesRange(details);
  return range === null ? "" : details.slice(range.start, range.end).trim();
}

/** `details` without its `## Notes` section (heading included). */
export function withoutNotesSection(details: string): string {
  const range = notesRange(details);
  return range === null ? details : details.slice(0, range.heading) + details.slice(range.end);
}

/**
 * `details` with the text of its `## Notes` section replaced, or the section
 * appended when missing. The text is stored trimmed with one final newline
 * (nothing when empty); the rest of `details` stays byte for byte. Throws when
 * the text has a `## ` line, which would start a new section.
 */
export function setNotesSection(details: string, notes: string): string {
  if (ANY_HEADING.test(notes)) {
    throw new Error("Notes cannot contain a line starting with `## `: it would start a new section");
  }
  const trimmed = notes.trim();
  const text = trimmed === "" ? "" : `${trimmed}\n`;
  const range = notesRange(details);
  if (range === null) {
    const gap = details === "" || details.endsWith("\n") ? "" : "\n";
    return `${details}${gap}\n## Notes\n${text}`;
  }
  const heading = details.slice(range.heading, range.start);
  const headingLine = heading.endsWith("\n") ? heading : `${heading}\n`;
  const rest = details.slice(range.end);
  return details.slice(0, range.heading) + headingLine + text + (rest === "" || text === "" ? "" : "\n") + rest;
}

// ---- graph -------------------------------------------------------------------

export interface GraphNode {
  name: string;
  id: string;
  kind: string;
  type: string;
  label: string;
  summary: string;
  scope: "global" | "project";
  projectId: string | null;
  importance: number;
  pinned: boolean;
  unconfirmed: boolean;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: "relation" | "mention";
  relation?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Links whose target is no memory. */
  broken: Array<{ source: string; target: string }>;
  /** Entities with no edge in or out. */
  unconnected: string[];
}

function sectionOf(body: string, heading: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

/** Nodes, edges, broken links and unconnected entities; `digest` memories are left out. */
export function buildGraph(memories: readonly MemoryRecord[]): Graph {
  const included = memories.filter((m) => !m.tags.includes("digest"));
  const names = new Set(included.map((m) => m.name));
  // Left out of the graph, but they exist: a link to one is no broken link.
  const digests = new Set(memories.filter((m) => m.tags.includes("digest")).map((m) => m.name));
  const edges: GraphEdge[] = [];
  const broken: Array<{ source: string; target: string }> = [];
  const byPair = new Map<string, GraphEdge>();
  const brokenSeen = new Set<string>();
  const add = (edge: GraphEdge) => {
    const key = `${edge.source}\u0000${edge.target}`;
    const existing = byPair.get(key);
    if (existing === undefined) {
      byPair.set(key, edge);
      edges.push(edge);
    } else if (existing.type === "mention" && edge.type === "relation") {
      existing.type = "relation";
      existing.relation = edge.relation;
    }
  };
  for (const m of included) {
    const body = splitDetails(m.details).body;
    const found: Array<Omit<GraphEdge, "source">> = [];
    for (const r of parseRelations(sectionOf(body, "Relations"))) {
      found.push({ target: r.target, type: "relation", relation: r.type });
    }
    for (const link of parseLinks(body)) found.push({ target: link.target, type: "mention" });
    for (const { target, ...rest } of found) {
      if (target === m.name) continue;
      if (!names.has(target)) {
        if (digests.has(target)) continue;
        const key = `${m.name}\u0000${target}`;
        if (!brokenSeen.has(key)) {
          brokenSeen.add(key);
          broken.push({ source: m.name, target });
        }
        continue;
      }
      add({ source: m.name, target, ...rest });
    }
  }
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const nodes: GraphNode[] = included.map((m) => ({
    name: m.name,
    id: entityFields(m)?.id ?? m.id,
    kind: m.kind,
    type: memoryType(m),
    label: memoryLabel(m),
    summary: m.summary,
    scope: m.scope,
    projectId: m.projectId,
    importance: m.importance,
    pinned: m.pinned,
    unconfirmed: m.tags.includes("unconfirmed"),
    degree: degree.get(m.name) ?? 0,
  }));
  const unconnected = included
    .filter((m) => isEntity(m) && (degree.get(m.name) ?? 0) === 0)
    .map((m) => m.name);
  return { nodes, edges, broken, unconnected };
}

/** The nodes within `depth` hops of `center` (either direction), center first, and the edges among them. */
export function localGraph(
  graph: Graph,
  center: string,
  depth: 1 | 2,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const byName = new Map(graph.nodes.map((n) => [n.name, n]));
  if (!byName.has(center)) return { nodes: [], edges: [] };
  const seen = [center];
  let frontier = [center];
  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];
    for (const name of frontier) {
      for (const e of graph.edges) {
        const other = e.source === name ? e.target : e.target === name ? e.source : null;
        if (other !== null && !seen.includes(other)) {
          seen.push(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return {
    nodes: seen.map((name) => byName.get(name)!),
    edges: graph.edges.filter((e) => seen.includes(e.source) && seen.includes(e.target)),
  };
}

export interface Backlink {
  node: GraphNode;
  type: "relation" | "mention";
  relation?: string;
}

/** The nodes that link to `name`, with the kind of link. */
export function backlinks(graph: Graph, name: string): Backlink[] {
  const byName = new Map(graph.nodes.map((n) => [n.name, n]));
  const result: Backlink[] = [];
  for (const e of graph.edges) {
    const node = byName.get(e.source);
    if (e.target !== name || node === undefined) continue;
    result.push(e.relation === undefined ? { node, type: e.type } : { node, type: e.type, relation: e.relation });
  }
  return result;
}

/** The typed relations in an entity's `## Relations` section. */
export function entityRelations(m: MemoryRecord): Relation[] {
  return parseRelations(sectionOf(splitDetails(m.details).body, "Relations"));
}

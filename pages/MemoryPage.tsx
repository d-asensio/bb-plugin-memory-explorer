// The Memory page.
//
// BB memory as a knowledge base, read through `knowledge_list` (server.ts).
// The Table tab lists every memory with its type's icon and colour
// (type-style.ts), filtered by type and searched by name, label, aliases,
// email, Slack id and summary, sortable by column. The Graph tab draws every
// memory and link, each relation an arrow labelled with its type (GraphView.tsx:
// zoom, pan, drag to pin), then lists the unconnected entities and the broken
// links. Clicking a row or a node opens the memory in a drawer
// (MemoryDetail.tsx). Nothing watches memory: Refresh reads it again.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginRpcResult } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { ENTITY_TYPES, KIND_TYPES, matchesQuery, type GraphNode } from "../knowledge";
import { conceptSummary, conceptTitle, relativeDay, typeStyle } from "../type-style";
import { GraphView } from "./GraphView";
import { MemoryDetail } from "./MemoryDetail";
import { TypeIcon, TypeLabel, useDarkMode } from "./TypeIcon";
import { Icon } from "@/components/ui/icon";
import {
  BUTTON_SECONDARY,
  CHIP_ATTENTION,
  CHIP_DASHED,
  CHIP_OUTLINE,
  FOCUS_RING,
  FONT_SANS,
  TYPE_LABEL,
} from "@/lib/styles";
import { cn } from "@/lib/utils";

type KnowledgeList = PluginRpcResult<(typeof rpcContract)["knowledge_list"]>;
type Tab = "table" | "graph";

/** Type filter value for "every type". */
const ALL = "all";
/** The type chips, in order: the entity types, then the other kinds. */
const TYPE_ORDER: readonly string[] = [...ENTITY_TYPES, ...KIND_TYPES];
const GRAPH_HINT =
  "Scroll or use + and − to zoom, drag the background to pan, drag a node to pin it where you drop it, double-click a pinned node to release it. Arrows are relations, labelled with their type when you point at a memory or zoom in; dashed lines are mentions.";
/** Pinned graph nodes survive switching tabs under this key. */
const GRAPH_PIN_KEY = "memory";

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isUnconfirmedPreference(node: GraphNode): boolean {
  return node.type === "preference" && node.unconfirmed;
}

/** The knowledge graph and the memories it is built from, read again on refresh. */
function useKnowledge() {
  const rpc = useRpc<typeof rpcContract>();
  // undefined: first fetch in flight.
  const [list, setList] = useState<KnowledgeList | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the latest read lands, whatever order the answers arrive in.
  const latest = useRef(0);
  const refetch = useCallback(() => {
    const read = ++latest.current;
    setLoading(true);
    rpc.call("knowledge_list", {}).then(
      (result) => {
        if (read !== latest.current) return;
        setList(result);
        setError(null);
        setLoading(false);
      },
      (cause: unknown) => {
        if (read !== latest.current) return;
        setError(errorText(cause));
        setLoading(false);
      },
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  return { list, loading, error, refetch };
}

function SearchBox({
  value,
  onChange,
  total,
}: {
  value: string;
  onChange: (value: string) => void;
  total: number;
}) {
  return (
    <span className="relative flex min-w-[180px] flex-1">
      <Icon
        name="Search"
        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value !== "") {
            event.preventDefault();
            event.stopPropagation();
            onChange("");
          }
        }}
        placeholder={`Search ${total} concepts by name, alias, email, Slack or summary`}
        aria-label="Search memories"
        autoComplete="off"
        spellCheck={false}
        className={cn(
          "h-9 w-full rounded-[8px] border border-border bg-transparent pl-8 pr-3 text-[13px] text-foreground transition-[border-color,box-shadow] duration-[120ms] ease-[ease] placeholder:text-muted-foreground hover:border-foreground/30 [&::-webkit-search-cancel-button]:hidden",
          FOCUS_RING,
        )}
      />
    </span>
  );
}

function TypeChips({
  nodes,
  type,
  onChange,
  dark,
}: {
  nodes: GraphNode[];
  type: string;
  onChange: (type: string) => void;
  dark: boolean;
}) {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  const known = TYPE_ORDER.filter((t) => counts.has(t));
  const unknown = [...counts.keys()].filter((t) => !TYPE_ORDER.includes(t)).sort();
  const chip = (active: boolean) =>
    cn(
      "inline-flex h-7 items-center gap-1.5 rounded-full border text-[12px] leading-none transition-[background-color,border-color,opacity] duration-[120ms] ease-[ease]",
      FOCUS_RING,
      active
        ? "border-foreground/40 bg-accent text-foreground"
        : "border-border text-foreground hover:bg-accent",
    );
  return (
    <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-1.5">
      <button
        type="button"
        aria-pressed={type === ALL}
        onClick={() => onChange(ALL)}
        className={cn(chip(type === ALL), "px-2.5")}
      >
        All
        <span className="tabular-nums text-muted-foreground">{nodes.length}</span>
      </button>
      {[...known, ...unknown].map((value) => {
        const active = type === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? ALL : value)}
            className={cn(chip(active), "pl-1 pr-2.5", type !== ALL && !active && "opacity-50 hover:opacity-100")}
          >
            <TypeIcon type={value} dark={dark} size="xs" />
            {typeStyle(value).label}
            <span className="tabular-nums text-muted-foreground">{counts.get(value)}</span>
          </button>
        );
      })}
    </div>
  );
}

type SortKey = "label" | "type" | "summary" | "degree" | "updatedAt";
interface Row {
  node: GraphNode;
  updatedAt: number;
}

const COLUMNS: Array<{ key: SortKey; label: string; className: string; numeric?: boolean }> = [
  { key: "label", label: "Concept", className: "w-[40%] md:w-[32%]" },
  { key: "type", label: "Type", className: "hidden w-[120px] sm:table-cell" },
  { key: "summary", label: "Summary", className: "hidden md:table-cell" },
  { key: "degree", label: "Links", className: "w-[64px]", numeric: true },
  { key: "updatedAt", label: "Updated", className: "hidden w-[96px] sm:table-cell", numeric: true },
];

function compareRows(a: Row, b: Row, key: SortKey): number {
  switch (key) {
    case "label":
      return a.node.label.localeCompare(b.node.label);
    case "type":
      return (
        TYPE_ORDER.indexOf(a.node.type) - TYPE_ORDER.indexOf(b.node.type) ||
        a.node.label.localeCompare(b.node.label)
      );
    case "summary":
      return a.node.summary.localeCompare(b.node.summary);
    case "degree":
      return a.node.degree - b.node.degree;
    case "updatedAt":
      return a.updatedAt - b.updatedAt;
  }
}

function MemoryTable({
  rows,
  selected,
  onSelect,
  dark,
}: {
  rows: Row[];
  selected: string | null;
  onSelect: (name: string) => void;
  dark: boolean;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "updatedAt", dir: -1 });
  const sorted = useMemo(
    () => [...rows].sort((a, b) => compareRows(a, b, sort.key) * sort.dir),
    [rows, sort],
  );
  const now = Date.now();
  const onKey = (event: KeyboardEvent<HTMLTableRowElement>, name: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(name);
    }
  };
  if (rows.length === 0) {
    return (
      <p className="px-3 py-10 text-center text-[13px] text-muted-foreground">No memories match.</p>
    );
  }
  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
      <thead>
        <tr>
          {COLUMNS.map((column) => {
            const active = sort.key === column.key;
            return (
              <th
                key={column.key}
                scope="col"
                aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                className={cn(
                  "sticky top-0 z-[1] border-b border-border bg-card px-3 py-2 text-left text-[11px] font-medium text-muted-foreground",
                  column.numeric && "text-right",
                  column.className,
                )}
              >
                <button
                  type="button"
                  onClick={() =>
                    setSort((current) =>
                      current.key === column.key
                        ? { key: column.key, dir: current.dir === 1 ? -1 : 1 }
                        : { key: column.key, dir: column.numeric ? -1 : 1 },
                    )
                  }
                  className={cn(
                    "inline-flex items-center gap-1 rounded-[4px] hover:text-foreground",
                    FOCUS_RING,
                    active && "text-foreground",
                  )}
                >
                  {column.label}
                  {active ? <span aria-hidden>{sort.dir === 1 ? "↑" : "↓"}</span> : null}
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map(({ node, updatedAt }) => {
          const isSelected = node.name === selected;
          return (
            <tr
              key={node.name}
              tabIndex={0}
              aria-selected={isSelected}
              onClick={() => onSelect(node.name)}
              onKeyDown={(event) => onKey(event, node.name)}
              className={cn(
                "group cursor-pointer outline-none [&>td]:border-b [&>td]:border-border [&>td]:transition-colors [&>td]:duration-[120ms] last:[&>td]:border-b-0",
                isSelected ? "[&>td]:bg-accent" : "hover:[&>td]:bg-accent/60",
                "focus-visible:[&>td]:bg-accent",
              )}
            >
              <td className="px-3 py-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <TypeIcon type={node.type} dark={dark} size="md" />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium text-foreground">{node.label}</span>
                      {isUnconfirmedPreference(node) ? (
                        <span className={cn(CHIP_ATTENTION, "shrink-0 px-1.5 py-0.5 text-[10px]")}>
                          unconfirmed
                        </span>
                      ) : null}
                      {node.pinned ? (
                        <Icon
                          name="Pin"
                          className="size-3 shrink-0 text-muted-foreground"
                          aria-label="Pinned"
                        />
                      ) : null}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {node.name}
                    </div>
                  </div>
                </div>
              </td>
              <td className="hidden px-3 py-2 sm:table-cell">
                <TypeLabel type={node.type} dark={dark} />
              </td>
              <td className="hidden px-3 py-2 md:table-cell">
                <span className="line-clamp-2 break-words text-[12px] leading-[1.45] text-muted-foreground">
                  {node.summary}
                </span>
              </td>
              <td className="px-3 py-2 text-right text-[12px] tabular-nums text-muted-foreground">
                {node.degree === 0 ? "–" : node.degree}
              </td>
              <td
                className="hidden whitespace-nowrap px-3 py-2 text-right text-[12px] tabular-nums text-muted-foreground sm:table-cell"
                title={updatedAt === 0 ? undefined : new Date(updatedAt).toLocaleString()}
              >
                {updatedAt === 0 ? "–" : relativeDay(updatedAt, now)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Tabs({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <div role="tablist" aria-label="View" className="inline-flex rounded-[10px] bg-muted p-[3px]">
      {(["table", "graph"] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          id={`memory-tab-${value}`}
          aria-selected={tab === value}
          onClick={() => onChange(value)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-[120ms] ease-[ease]",
            FOCUS_RING,
            tab === value
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <svg
            aria-hidden
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {value === "table" ? (
              <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18" />
            ) : (
              <>
                <circle cx="6" cy="6" r="3" />
                <circle cx="18" cy="8" r="3" />
                <circle cx="10" cy="18" r="3" />
                <path d="M8.9 6.5 15 7.5M7.2 8.8l1.7 6.4M16.2 10.4l-4.4 5.4" />
              </>
            )}
          </svg>
          {value === "table" ? "Table" : "Graph"}
        </button>
      ))}
    </div>
  );
}

/** The open memory, sliding in from the right over the page. */
function Drawer({
  open,
  modal,
  onClose,
  asideRef,
  children,
}: {
  open: boolean;
  /** Dim the page behind and close on a click there (the table); the graph stays usable. */
  modal: boolean;
  onClose: () => void;
  /** The drawer's element, which the graph keeps its zoom buttons and selected node clear of. */
  asideRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      // Escape inside the Notes editor or another field belongs to that field.
      if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "absolute inset-0 z-[20] bg-background/40 transition-opacity duration-200",
          open && modal ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        ref={asideRef}
        role="dialog"
        aria-modal={modal}
        aria-label="Memory"
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "absolute inset-y-0 right-0 z-[21] flex w-full flex-col border-l border-border bg-popover text-popover-foreground shadow-lg transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:w-[min(520px,92%)]",
          open ? "translate-x-0" : "pointer-events-none translate-x-[105%]",
        )}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
          className={cn(
            "absolute right-3 top-3 z-[1] flex size-8 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            FOCUS_RING,
          )}
        >
          <Icon name="X" className="size-4" aria-hidden />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-5">{children}</div>
      </aside>
    </>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="rounded-full bg-foreground/10 px-2 py-1 text-[11px] font-medium leading-none tracking-normal text-foreground/80">
      {n}
    </span>
  );
}

function Unconnected({
  names,
  nodeByName,
  onSelect,
}: {
  names: string[];
  nodeByName: ReadonlyMap<string, GraphNode>;
  onSelect: (name: string) => void;
}) {
  const label = (name: string) => nodeByName.get(name)?.label ?? name;
  return (
    <section aria-labelledby="graph-unconnected" className="flex flex-col gap-2">
      <h2
        id="graph-unconnected"
        className={cn(TYPE_LABEL, "flex items-center gap-2 text-foreground/50")}
      >
        Unconnected
        <Count n={names.length} />
      </h2>
      {names.length === 0 ? (
        <p className="text-[12px] text-foreground/40">Every entity has a link.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {[...names]
            .sort((a, b) => label(a).localeCompare(label(b)))
            .map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onSelect(name)}
                title={name}
                className={CHIP_OUTLINE}
              >
                {label(name)}
              </button>
            ))}
        </div>
      )}
    </section>
  );
}

function BrokenLinks({
  broken,
  nodeByName,
  onSelect,
}: {
  broken: Array<{ source: string; target: string }>;
  nodeByName: ReadonlyMap<string, GraphNode>;
  onSelect: (name: string) => void;
}) {
  return (
    <section aria-labelledby="graph-broken" className="flex flex-col gap-2">
      <h2 id="graph-broken" className={cn(TYPE_LABEL, "flex items-center gap-2 text-foreground/50")}>
        Broken links
        <Count n={broken.length} />
      </h2>
      {broken.length === 0 ? (
        <p className="text-[12px] text-foreground/40">No broken links.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {broken.map(({ source, target }) => (
            <li
              key={`${source}\u0000${target}`}
              className="flex flex-wrap items-center gap-1.5 text-[12px] text-foreground/50"
            >
              <button
                type="button"
                onClick={() => onSelect(source)}
                title={source}
                className={CHIP_OUTLINE}
              >
                {nodeByName.get(source)?.label ?? source}
              </button>
              <span aria-hidden>→</span>
              <span className="sr-only">links to</span>
              <span title="No memory has this name" className={CHIP_DASHED}>
                {target}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GraphTab({
  list,
  nodes,
  nodeByName,
  type,
  query,
  matches,
  selected,
  onSelect,
  showMentions,
  onShowMentions,
  drawerRef,
  drawerOpen,
}: {
  list: KnowledgeList;
  nodes: GraphNode[];
  nodeByName: ReadonlyMap<string, GraphNode>;
  type: string;
  query: string;
  matches: (node: GraphNode) => boolean;
  selected: string | null;
  onSelect: (name: string | null) => void;
  showMentions: boolean;
  onShowMentions: (show: boolean) => void;
  /** The page's drawer, open over the right of the graph while it shows a memory. */
  drawerRef: RefObject<HTMLElement | null>;
  drawerOpen: boolean;
}) {
  const shownNodes = useMemo(
    () => (type === ALL ? nodes : nodes.filter((node) => node.type === type)),
    [nodes, type],
  );
  const shownEdges = useMemo(() => {
    const names = new Set(shownNodes.map((node) => node.name));
    return list.edges.filter((e) => names.has(e.source) && names.has(e.target));
  }, [list, shownNodes]);
  const highlight = useMemo(
    () =>
      query.trim() === ""
        ? null
        : new Set(shownNodes.filter(matches).map((node) => node.name)),
    [query, shownNodes, matches],
  );
  return (
    <div
      role="tabpanel"
      id="memory-panel-graph"
      aria-labelledby="memory-tab-graph"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
        {highlight === null ? null : (
          <span role="status">
            {highlight.size} {highlight.size === 1 ? "match" : "matches"}
          </span>
        )}
        <label className="ml-auto inline-flex cursor-pointer select-none items-center gap-1.5 text-foreground/80">
          <input
            type="checkbox"
            checked={showMentions}
            onChange={(event) => onShowMentions(event.target.checked)}
            className="size-3.5 accent-foreground"
          />
          Show mentions
        </label>
      </div>
      {shownNodes.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-border px-3 py-10 text-center text-[13px] text-muted-foreground">
          No memories of this type.
        </div>
      ) : (
        <GraphView
          nodes={shownNodes}
          edges={shownEdges}
          selected={selected}
          onSelect={onSelect}
          showMentions={showMentions}
          highlight={highlight}
          height={600}
          pinKey={GRAPH_PIN_KEY}
          legend={false}
          coverRef={drawerRef}
          covered={drawerOpen}
        />
      )}
      <p className="text-[12px] leading-normal text-muted-foreground">{GRAPH_HINT}</p>
      <Unconnected names={list.unconnected} nodeByName={nodeByName} onSelect={onSelect} />
      <BrokenLinks broken={list.broken} nodeByName={nodeByName} onSelect={onSelect} />
    </div>
  );
}

export function MemoryPage() {
  const { list, loading, error, refetch } = useKnowledge();
  const dark = useDarkMode();
  const [tab, setTab] = useState<Tab>("table");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string>(ALL);
  // The memory open in the drawer; it stays mounted while the drawer slides out.
  const [selected, setSelected] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const [showMentions, setShowMentions] = useState(true);
  // Bumped to read the open memory again.
  const [version, setVersion] = useState(0);
  // Unsaved Notes by memory name, kept while the page is open.
  const [noteDrafts, setNoteDrafts] = useState<ReadonlyMap<string, string>>(() => new Map());

  const memories = useMemo(
    () => new Map((list?.memories ?? []).map((memory) => [memory.name, memory])),
    [list],
  );
  // Shown with a readable title and without the summary's "Label (type) —" lead-in.
  const nodes = useMemo(
    () =>
      (list?.nodes ?? [])
        .map((node) => ({
          ...node,
          label: conceptTitle(node.label, node.name),
          summary: conceptSummary(node.summary, node.label, node.type),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [list],
  );
  const nodeByName = useMemo(() => new Map(nodes.map((node) => [node.name, node])), [nodes]);
  // The drawer's local graph names its nodes as the table does.
  const titledGraph = useMemo(() => (list === undefined ? undefined : { ...list, nodes }), [list, nodes]);
  const matches = useCallback(
    (node: GraphNode) => {
      const memory = memories.get(node.name);
      return memory !== undefined && matchesQuery(memory, query);
    },
    [memories, query],
  );
  const exists = useCallback((name: string) => memories.has(name), [memories]);
  const noteDraft = useCallback(
    (name: string, text: string) => setNoteDrafts((drafts) => new Map(drafts).set(name, text)),
    [],
  );
  const noteSaved = useCallback(
    (name: string, text: string) =>
      setNoteDrafts((drafts) => {
        // Text typed while saving stays a draft.
        if (drafts.get(name) !== text) return drafts;
        const next = new Map(drafts);
        next.delete(name);
        return next;
      }),
    [],
  );
  const open = useCallback((name: string | null) => {
    if (name === null) {
      setDrawerOpen(false);
      return;
    }
    setSelected(name);
    setDrawerOpen(true);
  }, []);
  const close = useCallback(() => setDrawerOpen(false), []);

  const reread = () => {
    refetch();
    setVersion((v) => v + 1);
  };

  const rows = useMemo(
    () =>
      nodes
        .filter((node) => (type === ALL || node.type === type) && matches(node))
        .map((node) => ({ node, updatedAt: memories.get(node.name)?.updatedAt ?? 0 })),
    [nodes, type, matches, memories],
  );

  let content: ReactNode;
  if (list === undefined) {
    content =
      error === null ? (
        <p role="status" className="py-6 text-[13px] text-muted-foreground">
          Loading memory…
        </p>
      ) : null;
  } else if (nodes.length === 0) {
    content =
      list.error === undefined ? (
        <div className="rounded-[12px] border border-dashed border-border px-3 py-10 text-center text-[13px] text-muted-foreground">
          No memories yet.
        </div>
      ) : (
        <div
          role="alert"
          className="rounded-[12px] border border-dashed border-destructive/40 px-3 py-10 text-center text-[13px] text-destructive"
        >
          {list.error}
        </div>
      );
  } else if (tab === "graph") {
    content = (
      <GraphTab
        list={list}
        nodes={nodes}
        nodeByName={nodeByName}
        type={type}
        query={query}
        matches={matches}
        selected={drawerOpen ? selected : null}
        onSelect={open}
        showMentions={showMentions}
        onShowMentions={setShowMentions}
        drawerRef={drawerRef}
        drawerOpen={drawerOpen && selected !== null}
      />
    );
  } else {
    content = (
      <div
        role="tabpanel"
        id="memory-panel-table"
        aria-labelledby="memory-tab-table"
        className="overflow-hidden rounded-[12px] border border-border bg-card"
      >
        <MemoryTable
          rows={rows}
          selected={drawerOpen ? selected : null}
          onSelect={open}
          dark={dark}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 flex-1 flex-col overflow-hidden text-foreground antialiased",
        FONT_SANS,
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-4 pb-8 pt-4 md:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[20px] font-semibold leading-[1.3] tracking-[-0.03em]">
              Memory
            </h1>
            {nodes.length === 0 ? null : (
              <span className="text-[13px] text-muted-foreground">
                {nodes.length} {nodes.length === 1 ? "concept" : "concepts"}
                {list === undefined ? null : ` · ${list.edges.length} links`}
              </span>
            )}
            {error === null ? null : (
              <p
                role="alert"
                className="inline-flex items-center gap-[5px] rounded-full bg-destructive/10 px-[9px] py-1 text-[12px] font-medium text-destructive"
              >
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={reread}
              disabled={loading}
              className={cn(BUTTON_SECONDARY, "ml-auto h-8 rounded-[8px] border text-[13px]")}
            >
              <Icon
                name="ArrowReloadHorizontal"
                fallback="RotateCcw"
                className={cn("size-3.5", loading && "animate-spin motion-reduce:animate-none")}
                aria-hidden
              />
              Refresh
            </button>
          </div>
          {nodes.length === 0 ? null : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Tabs tab={tab} onChange={setTab} />
                <SearchBox value={query} onChange={setQuery} total={nodes.length} />
              </div>
              <TypeChips nodes={nodes} type={type} onChange={setType} dark={dark} />
            </>
          )}
          {content}
        </div>
      </div>
      <Drawer
        open={drawerOpen && selected !== null}
        modal={tab === "table"}
        onClose={close}
        asideRef={drawerRef}
      >
        {selected === null || titledGraph === undefined ? null : (
          <MemoryDetail
            key={selected}
            name={selected}
            node={nodeByName.get(selected)}
            graph={titledGraph}
            exists={exists}
            version={version}
            noteDraft={noteDrafts.get(selected)}
            onNoteDraft={noteDraft}
            onNoteSaved={noteSaved}
            onSelect={open}
            onConfirmed={reread}
            onDiscarded={() => {
              setDrawerOpen(false);
              setSelected(null);
              refetch();
            }}
            inDrawer
          />
        )}
      </Drawer>
    </div>
  );
}

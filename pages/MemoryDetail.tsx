// One memory, in the page's drawer.
//
// What `knowledge_get` returns for the selected memory: its summary, its text
// as sections whose `[[links]]` select the memory they name, the memories
// that link to it, its local graph, the threads about it and, for an entity,
// its Notes (the entity memory's `## Notes` section). An unconfirmed
// preference gets Confirm and Discard.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginRpcResult } from "@get-bb/plugin-sdk/app";
import type { RelatedThread, rpcContract } from "../server";
import {
  ENTITY_TYPES,
  entityFields,
  localGraph,
  type Graph,
  type GraphNode,
} from "../knowledge";
import type { Block, Segment } from "../blocks";
import { GraphView } from "./GraphView";
import { TypeIcon, useDarkMode } from "./TypeIcon";
import { conceptSummary, typeStyle } from "../type-style";
import { Icon } from "@/components/ui/icon";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  CHIP_ATTENTION,
  CHIP_MUTED,
  CHIP_OUTLINE,
  FOCUS_RING,
  TYPE_LABEL,
} from "@/lib/styles";
import { cn } from "@/lib/utils";

type Detail = PluginRpcResult<(typeof rpcContract)["knowledge_get"]>;

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** `at` (ms) as a local YYYY-MM-DD. */
function day(at: number): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The memory called `name`; read again when `name` or `version` changes. */
function useMemoryDetail(name: string, version: number) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<{
    name: string;
    detail: Detail | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    let live = true;
    rpc.call("knowledge_get", { name }).then(
      (detail) => {
        if (live) setState({ name, detail, error: null });
      },
      (cause: unknown) => {
        if (live) setState({ name, detail: null, error: errorText(cause) });
      },
    );
    return () => {
      live = false;
    };
  }, [rpc, name, version]);
  // Never show another memory while this one loads.
  return state !== null && state.name === name ? state : null;
}

/** A link chip's target: http(s) URLs as is, email addresses as mailto. */
function linkHref(key: string, value: string): string | null {
  if (/^https?:\/\//i.test(value)) return value;
  if (key === "email" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return `mailto:${value}`;
  }
  return null;
}

function LinkChips({ links }: { links: Record<string, string> }) {
  const entries = Object.entries(links);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => {
        const href = linkHref(key, value);
        const label = (
          <>
            <span className="text-foreground/50">{key}</span>
            <span className="min-w-0 truncate">{value}</span>
          </>
        );
        return href === null ? (
          <span key={key} title={value} className={CHIP_MUTED}>
            {label}
          </span>
        ) : (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            title={value}
            className={CHIP_OUTLINE}
          >
            {label}
            <Icon name="ExternalLink" className="size-3 shrink-0 text-foreground/40" aria-hidden />
          </a>
        );
      })}
    </div>
  );
}

/** Opens a memory from a link in the text or a list. */
type Select = (name: string) => void;

function Segments({
  segments,
  exists,
  onSelect,
}: {
  segments: Segment[];
  exists: (name: string) => boolean;
  onSelect: Select;
}) {
  return (
    <>
      {segments.map((segment, index) => {
        const target = segment.memory;
        if (target !== undefined) {
          return exists(target) ? (
            <button
              key={index}
              type="button"
              onClick={() => onSelect(target)}
              title={target}
              className={cn(
                "inline rounded-[4px] text-left font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground",
                FOCUS_RING,
              )}
            >
              {segment.text}
            </button>
          ) : (
            <span
              key={index}
              title={`No memory named ${target}`}
              className="text-foreground/50 underline decoration-dashed decoration-foreground/30 underline-offset-2"
            >
              {segment.text}
            </span>
          );
        }
        return segment.href === undefined ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noreferrer"
            title={segment.href}
            className={cn(
              "break-all rounded-[4px] text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground",
              FOCUS_RING,
            )}
          >
            {segment.text}
          </a>
        );
      })}
    </>
  );
}

type BodySection = { heading: string | null; blocks: Block[] };

/** Groups blocks under their `## ` heading; text before any heading has none. */
function toSections(blocks: Block[]): BodySection[] {
  const sections: BodySection[] = [];
  for (const block of blocks) {
    if (block.type === "heading") {
      sections.push({ heading: block.text, blocks: [] });
    } else {
      if (sections.length === 0) sections.push({ heading: null, blocks: [] });
      sections[sections.length - 1]!.blocks.push(block);
    }
  }
  return sections;
}

function SectionBlocks({
  blocks,
  exists,
  onSelect,
}: {
  blocks: Block[];
  exists: (name: string) => boolean;
  onSelect: Select;
}) {
  // Consecutive bullets share one list.
  const out: ReactNode[] = [];
  let bullets: Block[] = [];
  const flush = () => {
    if (bullets.length === 0) return;
    out.push(
      <ul key={`ul-${out.length}`} className="flex list-disc flex-col gap-1 pl-5 marker:text-foreground/30">
        {bullets.map((bullet, index) =>
          bullet.type === "heading" ? null : (
            <li key={index}>
              <Segments segments={bullet.segments} exists={exists} onSelect={onSelect} />
            </li>
          ),
        )}
      </ul>,
    );
    bullets = [];
  };
  for (const block of blocks) {
    if (block.type === "bullet") {
      bullets.push(block);
    } else if (block.type === "text") {
      flush();
      out.push(
        <p key={`p-${out.length}`}>
          <Segments segments={block.segments} exists={exists} onSelect={onSelect} />
        </p>,
      );
    }
  }
  flush();
  return <>{out}</>;
}

function Body({
  blocks,
  exists,
  onSelect,
}: {
  blocks: Block[];
  exists: (name: string) => boolean;
  onSelect: Select;
}) {
  const sections = toSections(blocks);
  if (sections.length === 0) {
    return <p className="text-[14px] text-foreground/40">No details yet.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {sections.map((section, index) => (
        <section key={index} className="flex flex-col gap-1.5">
          {section.heading === null ? null : (
            <h3 className="text-[14px] font-semibold leading-[1.3] tracking-[-0.01em]">
              {section.heading}
            </h3>
          )}
          {section.blocks.length === 0 ? (
            <p className="text-[14px] text-foreground/30">—</p>
          ) : (
            <div className="flex flex-col gap-1.5 whitespace-pre-wrap break-words text-[14px] leading-normal text-foreground/80">
              <SectionBlocks blocks={section.blocks} exists={exists} onSelect={onSelect} />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function LinkedFrom({
  backlinks,
  onSelect,
}: {
  backlinks: Detail["backlinks"];
  onSelect: Select;
}) {
  return (
    <section aria-labelledby="memory-linked-from" className="flex flex-col gap-2">
      <h3 id="memory-linked-from" className={cn(TYPE_LABEL, "text-foreground/50")}>
        Linked from
      </h3>
      {backlinks.length === 0 ? (
        <p className="text-[12px] text-foreground/40">No memory links here.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {backlinks.map(({ node, type, relation }) => (
            <button
              key={node.name}
              type="button"
              onClick={() => onSelect(node.name)}
              title={node.summary === "" ? node.name : node.summary}
              className={CHIP_OUTLINE}
            >
              <span className="min-w-0 truncate">{node.label}</span>
              <span className="shrink-0 text-foreground/50">
                {type === "relation" ? relation : "mentions"}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function LocalGraph({
  graph,
  name,
  onSelect,
}: {
  graph: Graph;
  name: string;
  onSelect: Select;
}) {
  const local = useMemo(() => localGraph(graph, name, 1), [graph, name]);
  return (
    <section aria-labelledby="memory-local-graph" className="flex flex-col gap-2">
      <h3 id="memory-local-graph" className={cn(TYPE_LABEL, "text-foreground/50")}>
        Local graph
      </h3>
      {local.edges.length === 0 ? (
        <p className="text-[12px] text-foreground/40">No links yet.</p>
      ) : (
        <GraphView
          nodes={local.nodes}
          edges={local.edges}
          selected={name}
          // A click on this memory or the background keeps it open.
          onSelect={(picked) => {
            if (picked !== null && picked !== name) onSelect(picked);
          }}
          height={220}
          controls={false}
        />
      )}
    </section>
  );
}

/** Threads whose title names the entity; with the Kanban plugin, its cards and their column. */
function RelatedThreads({ threads }: { threads: RelatedThread[] }) {
  const navigate = useBbNavigate();
  return (
    <section aria-labelledby="memory-related" className="flex flex-col gap-2">
      <h3 id="memory-related" className={cn(TYPE_LABEL, "text-foreground/50")}>
        Related threads
      </h3>
      {threads.length === 0 ? (
        <p className="text-[12px] text-foreground/40">No thread mentions it.</p>
      ) : (
        <ul className="divide-y divide-foreground/10 rounded-[16px] border border-foreground/10 bg-card">
          {threads.map((thread) => (
            <li key={thread.threadId}>
              <button
                type="button"
                onClick={() => navigate.toThread(thread.threadId)}
                className={cn(
                  "flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-foreground/5",
                  FOCUS_RING,
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-[1.3] tracking-[-0.01em]">
                  {thread.title}
                </span>
                {thread.column === null ? null : (
                  <span className={CHIP_MUTED}>{thread.column}</span>
                )}
                <Icon name="ChevronRight" className="size-3.5 shrink-0 text-foreground/40" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The Notes on an entity. `draft` (kept by the page, so switching memories
 * loses nothing) is the unsaved text, if any.
 */
function NotesEditor({
  name,
  notes,
  draft,
  onDraft,
  onSaved,
}: {
  name: string;
  notes: string;
  draft: string | undefined;
  onDraft: (name: string, text: string) => void;
  onSaved: (name: string, text: string) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  // What the plugin holds: `notes` as read, then what this editor saved.
  const [saved, setSaved] = useState(notes);
  useEffect(() => setSaved(notes), [notes]);
  const [status, setStatus] = useState<{ saving: boolean; error: string | null; done: boolean }>({
    saving: false,
    error: null,
    done: false,
  });
  const value = draft ?? saved;
  const dirty = value !== saved;

  const save = () => {
    const text = value;
    setStatus({ saving: true, error: null, done: false });
    rpc.call("knowledge_set_notes", { name, notes: text }).then(
      () => {
        setSaved(text);
        onSaved(name, text);
        setStatus({ saving: false, error: null, done: true });
      },
      (cause: unknown) => setStatus({ saving: false, error: errorText(cause), done: false }),
    );
  };

  return (
    <section aria-labelledby="memory-notes" className="flex flex-col gap-2">
      <h3 id="memory-notes" className={cn(TYPE_LABEL, "text-foreground/50")}>
        Notes
      </h3>
      <p id="memory-notes-hint" className="text-[12px] text-foreground/50">
        Agents can read your Notes; only you edit them here.
      </p>
      <textarea
        value={value}
        onChange={(event) => {
          onDraft(name, event.target.value);
          setStatus((current) => ({ ...current, done: false }));
        }}
        rows={5}
        aria-labelledby="memory-notes"
        aria-describedby="memory-notes-hint"
        className={cn(
          "min-h-24 w-full resize-y rounded-[10px] border-[1.5px] border-foreground/20 bg-card px-3 py-2 text-[14px] leading-normal text-foreground transition-[border-color,box-shadow] duration-[120ms] ease-[ease] hover:border-foreground/50",
          FOCUS_RING,
        )}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || status.saving}
          className={BUTTON_SECONDARY}
        >
          {status.saving ? "Saving…" : "Save"}
        </button>
        {status.error !== null ? (
          <p role="alert" className="text-[12px] text-[#FF3B30]">
            {status.error}
          </p>
        ) : dirty ? (
          <span className="text-[12px] text-foreground/50">Unsaved changes</span>
        ) : status.done ? (
          <span role="status" className="text-[12px] text-foreground/50">
            Saved
          </span>
        ) : null}
      </div>
    </section>
  );
}

function ConfirmPreference({
  name,
  onConfirmed,
  onDiscarded,
}: {
  name: string;
  onConfirmed: () => void;
  onDiscarded: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState<"confirm" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (action: "confirm" | "discard") => {
    setBusy(action);
    setError(null);
    const call =
      action === "confirm"
        ? rpc.call("knowledge_confirm", { name })
        : rpc.call("knowledge_forget", { name });
    call.then(
      () => {
        setBusy(null);
        if (action === "confirm") onConfirmed();
        else onDiscarded();
      },
      (cause: unknown) => {
        setBusy(null);
        setError(errorText(cause));
      },
    );
  };
  return (
    <div
      role="group"
      aria-label="Unconfirmed preference"
      className="flex flex-col gap-3 rounded-[16px] border border-[#FF9500]/40 bg-[#FF9500]/5 p-4"
    >
      <p className="text-[14px] leading-normal text-foreground/80">
        An agent recorded this preference and treats it as likely, not certain. Confirm it, or
        discard it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => run("confirm")}
          disabled={busy !== null}
          className={BUTTON_PRIMARY}
        >
          {busy === "confirm" ? "Confirming…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => run("discard")}
          disabled={busy !== null}
          className={BUTTON_SECONDARY}
        >
          {busy === "discard" ? "Discarding…" : "Discard"}
        </button>
        {error === null ? null : (
          <p role="alert" className="text-[12px] text-[#FF3B30]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export interface MemoryDetailProps {
  name: string;
  /** Its graph node; undefined for a memory the graph leaves out (the digest). */
  node: GraphNode | undefined;
  graph: Graph;
  /** True when a memory of that name exists; a link to any other name is broken. */
  exists: (name: string) => boolean;
  /** Bumped to read the memory again. */
  version: number;
  noteDraft: string | undefined;
  onNoteDraft: (name: string, text: string) => void;
  onNoteSaved: (name: string, text: string) => void;
  onSelect: Select;
  /** After Confirm: the page reads the list and this memory again. */
  onConfirmed: () => void;
  /** After Discard: the memory is gone. */
  onDiscarded: () => void;
  /** Shown in the page's drawer: no card of its own, the type's icon beside the title. */
  inDrawer?: boolean;
}

export function MemoryDetail(props: MemoryDetailProps) {
  const { name, node } = props;
  const loaded = useMemoryDetail(name, props.version);
  const detail = loaded?.detail ?? null;
  const memory = detail?.memory;
  const fields = memory === undefined ? null : entityFields(memory);
  const label = node?.label ?? detail?.label ?? name;
  const type = detail?.type ?? node?.type ?? null;
  const rawSummary = memory?.summary ?? node?.summary ?? "";
  const summary =
    props.inDrawer === true && type !== null
      ? conceptSummary(rawSummary, detail?.label ?? label, type)
      : rawSummary;
  const entity = type !== null && (ENTITY_TYPES as readonly string[]).includes(type);
  const unconfirmed =
    type === "preference" && (memory?.tags.includes("unconfirmed") ?? node?.unconfirmed ?? false);

  const dark = useDarkMode();
  const drawer = props.inDrawer === true;

  return (
    <article
      className={cn("flex flex-col gap-5", drawer ? "" : "rounded-[20px] bg-foreground/5 p-5")}
    >
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-3">
            {drawer && type !== null ? <TypeIcon type={type} dark={dark} size="lg" /> : null}
            <h2
              className={cn(
                "min-w-0 break-words text-[20px] font-semibold leading-[1.3] tracking-[-0.03em]",
                drawer && "pr-10 pt-1.5",
              )}
            >
              {label}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-foreground/50">
            {type === null ? null : (
              <span className={CHIP_MUTED}>{drawer ? typeStyle(type).label : type}</span>
            )}
            {drawer ? <span className="font-mono text-[11px]">{name}</span> : null}
            {fields?.status === undefined ? null : (
              <span className={CHIP_MUTED}>{fields.status}</span>
            )}
            {unconfirmed ? <span className={CHIP_ATTENTION}>unconfirmed</span> : null}
            {fields === null ? null : <span>confidence {fields.confidence}</span>}
            {memory === undefined ? null : <span>· updated {day(memory.updatedAt)}</span>}
          </div>
          {summary === "" ? null : (
            <p className="break-words text-[14px] leading-normal text-foreground/80">{summary}</p>
          )}
          {fields === null || fields.aliases.length === 0 ? null : (
            <p className="text-[12px] text-foreground/50">Also: {fields.aliases.join(", ")}</p>
          )}
        </div>
        {fields === null ? null : <LinkChips links={fields.links} />}
      </header>
      {unconfirmed && memory !== undefined ? (
        <ConfirmPreference
          name={name}
          onConfirmed={props.onConfirmed}
          onDiscarded={props.onDiscarded}
        />
      ) : null}
      <div className="rounded-[16px] border border-foreground/10 bg-card p-4">
        {loaded === null ? (
          <p role="status" className="text-[14px] text-foreground/50">
            Loading…
          </p>
        ) : detail === null ? (
          <p role="alert" className="text-[14px] text-[#FF3B30]">
            {loaded.error}
          </p>
        ) : (
          <Body blocks={detail.blocks} exists={props.exists} onSelect={props.onSelect} />
        )}
      </div>
      {detail === null ? null : <LinkedFrom backlinks={detail.backlinks} onSelect={props.onSelect} />}
      {node === undefined ? null : (
        <LocalGraph graph={props.graph} name={name} onSelect={props.onSelect} />
      )}
      {detail === null || !entity ? null : (
        <RelatedThreads threads={detail.relatedThreads} />
      )}
      {detail === null || detail.notes === null ? null : (
        <NotesEditor
          key={name}
          name={name}
          notes={detail.notes}
          draft={props.noteDraft}
          onDraft={props.onNoteDraft}
          onSaved={props.onNoteSaved}
        />
      )}
    </article>
  );
}

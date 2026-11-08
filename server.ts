// bb-plugin-memory-explorer — BB memory as a searchable table, a drawer for
// each memory and a zoomable link graph.
//
// The Memory page (app.tsx, pages/) reads memory through this server's RPC.
// The server reads and writes memory through the bundled Memory plugin's RPC
// (memory-source.ts); knowledge.ts derives entity fields, `[[links]]` and the
// graph. The plugin stores nothing of its own, and nothing watches memory: the
// page reads it again on Refresh.
//
// Optional, each used only when present or configured:
// - Related threads: an entity's drawer lists the threads whose title names
//   it. With the Kanban plugin installed (id `kanban`, RPC `board_get`) it
//   lists that board's cards instead, with their column, and an initiative's
//   cards.
// - The digest command (the `digestCommand` setting, digest-command.ts) runs
//   after a preference is confirmed or discarded.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { defineRpcContract, type BbPluginApi, type JsonValue } from "@get-bb/plugin-sdk";
import { z } from "zod";

import type { Block, Segment } from "./blocks";
import { runDigestCommand } from "./digest-command";
import {
  buildGraph,
  isEntity,
  type Backlink,
  type GraphEdge,
  type GraphNode,
  type MemoryRecord,
  type Relation,
} from "./knowledge";
import { knowledgeDetail } from "./knowledge-detail";
import { createMemorySource } from "./memory-source";
import { writeNotes } from "./notes-write";

/** At most this many open threads are matched against an entity. */
const MAX_THREADS = 500;
/** At most one "memory unavailable" log line per this long. */
const MEMORY_LOG_INTERVAL_MS = 60_000;
/** The Kanban plugin: its cards replace plain threads when it is installed. */
const KANBAN_PLUGIN = "kanban";
/** How long the drawer waits for the Kanban board before it lists plain threads. */
const KANBAN_TIMEOUT_MS = 5_000;

const memorySchema = z.object({
  id: z.string(),
  scope: z.enum(["global", "project"]),
  projectId: z.string().nullable(),
  name: z.string(),
  summary: z.string(),
  details: z.string(),
  kind: z.string(),
  tags: z.array(z.string()),
  importance: z.number(),
  pinned: z.boolean(),
  version: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
}) satisfies z.ZodType<MemoryRecord>;
const graphNodeSchema = z.object({
  name: z.string(),
  id: z.string(),
  kind: z.string(),
  type: z.string(),
  label: z.string(),
  summary: z.string(),
  scope: z.enum(["global", "project"]),
  projectId: z.string().nullable(),
  importance: z.number(),
  pinned: z.boolean(),
  unconfirmed: z.boolean(),
  degree: z.number(),
}) satisfies z.ZodType<GraphNode>;
const graphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum(["relation", "mention"]),
  relation: z.string().optional(),
}) satisfies z.ZodType<GraphEdge>;
const segmentSchema = z.object({
  text: z.string(),
  href: z.string().optional(),
  memory: z.string().optional(),
}) satisfies z.ZodType<Segment>;
const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string() }),
  z.object({ type: z.literal("bullet"), segments: z.array(segmentSchema) }),
  z.object({ type: z.literal("text"), segments: z.array(segmentSchema) }),
]) satisfies z.ZodType<Block>;
const relationSchema = z.object({
  type: z.string(),
  target: z.string(),
  label: z.string().nullable(),
}) satisfies z.ZodType<Relation>;
const backlinkSchema = z.object({
  node: graphNodeSchema,
  type: z.enum(["relation", "mention"]),
  relation: z.string().optional(),
}) satisfies z.ZodType<Backlink>;
const relatedThreadSchema = z.object({
  threadId: z.string(),
  title: z.string(),
  /** The thread's Kanban column, when the Kanban plugin is installed. */
  column: z.string().nullable(),
});
export type RelatedThread = z.infer<typeof relatedThreadSchema>;

/** What this plugin reads from the Kanban plugin's `board_get`; extra fields are ignored. */
const kanbanBoardSchema = z.looseObject({
  columns: z.array(z.looseObject({ id: z.string(), name: z.string() })),
  cards: z.array(
    z.looseObject({
      threadId: z.string(),
      title: z.string(),
      column: z.string(),
      initiative: z.string().nullable().optional(),
    }),
  ),
});

/** A thread an entity's related threads are picked from. */
interface ThreadCandidate {
  threadId: string;
  title: string;
  column: string | null;
  initiative: string | null;
}

export const rpcContract = defineRpcContract({
  /**
   * The knowledge graph over BB memory, with the memories it is built from
   * (the page searches their aliases, email and Slack id); empty lists with
   * `error` when memory is unavailable.
   */
  knowledge_list: {
    input: z.object({}),
    output: z.object({
      generatedAt: z.string(),
      memories: z.array(memorySchema),
      nodes: z.array(graphNodeSchema),
      edges: z.array(graphEdgeSchema),
      broken: z.array(z.object({ source: z.string(), target: z.string() })),
      unconnected: z.array(z.string()),
      error: z.string().optional(),
    }),
  },
  /** One memory with its blocks, relations, backlinks, related threads and, for an entity, its Notes. */
  knowledge_get: {
    input: z.object({ name: z.string().min(1) }),
    output: z.object({
      memory: memorySchema,
      type: z.string(),
      label: z.string(),
      blocks: z.array(blockSchema),
      relations: z.array(relationSchema),
      backlinks: z.array(backlinkSchema),
      relatedThreads: z.array(relatedThreadSchema),
      notes: z.string().nullable(),
    }),
  },
  /** Sets (empty text clears) the Notes of an entity: the `## Notes` section of its memory. */
  knowledge_set_notes: {
    input: z.object({ name: z.string().min(1), notes: z.string() }),
    output: z.object({ ok: z.literal(true) }),
  },
  /** Confirms an unconfirmed preference (removes the tag), then runs the digest command. */
  knowledge_confirm: {
    input: z.object({ name: z.string().min(1) }),
    output: z.object({ ok: z.literal(true) }),
  },
  /** Forgets an unconfirmed preference, then runs the digest command. */
  knowledge_forget: {
    input: z.object({ name: z.string().min(1) }),
    output: z.object({ ok: z.literal(true) }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    digestCommand: {
      type: "string",
      label: "Digest command",
      description:
        'Runs after you confirm or discard a preference, for example a script that rebuilds a digest of your preferences. A program or script and its arguments, run without a shell; put a path with spaces in double quotes. A .js, .mjs or .cjs script runs with Node, and BB_CLI names the bb command. Leave empty to run nothing.',
      default: "",
    },
  });

  const memorySource = createMemorySource((args) =>
    bb.sdk.plugins.callRpc({
      pluginId: args.pluginId,
      method: args.method,
      input: args.input as JsonValue,
      outputSchema: args.outputSchema,
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    }),
  );
  let lastMemoryLog = 0;

  function logMemoryError(message: string): void {
    const now = Date.now();
    if (now - lastMemoryLog < MEMORY_LOG_INTERVAL_MS) return;
    lastMemoryLog = now;
    bb.log.warn(message);
  }

  /** The bb command in the server's data folder, for scripts the digest command runs; undefined when absent. */
  function bbCliPath(): string | undefined {
    try {
      const cli = join(bb.server.experimental_dataDir, "bin", "bb");
      return existsSync(cli) ? cli : undefined;
    } catch {
      return undefined;
    }
  }

  /** Runs the digest command, if one is set. Never throws. */
  async function runDigest(): Promise<void> {
    const command = (await settings.get()).digestCommand.trim();
    if (command === "") return;
    await runDigestCommand(command, {
      bbCli: bbCliPath(),
      log: (message) => bb.log.warn(message),
    });
  }

  /** The Kanban board's cards, or null when the Kanban plugin is missing, slow or failing. */
  async function kanbanCards(): Promise<ThreadCandidate[] | null> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, KANBAN_TIMEOUT_MS);
    });
    try {
      const board = await Promise.race([
        bb.sdk.plugins.callRpc({
          pluginId: KANBAN_PLUGIN,
          method: "board_get",
          input: { projectId: null },
          outputSchema: kanbanBoardSchema,
          signal: controller.signal,
        }),
        timeout,
      ]);
      if (board === null) return null;
      const names = new Map(board.columns.map((column) => [column.id, column.name]));
      return board.cards.map((card) => ({
        threadId: card.threadId,
        title: card.title,
        column: names.get(card.column) ?? card.column,
        initiative: card.initiative ?? null,
      }));
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Open threads as bb lists them; none when they cannot be read. */
  async function openThreads(): Promise<ThreadCandidate[]> {
    try {
      const threads = await bb.sdk.threads.list({ archived: false, limit: MAX_THREADS });
      return threads.map((thread) => ({
        threadId: thread.id,
        title: thread.title ?? thread.titleFallback ?? "Untitled thread",
        column: null,
        initiative: null,
      }));
    } catch {
      return [];
    }
  }

  /** Throws unless `name` is an unconfirmed preference; returns its memory, read fresh. */
  async function unconfirmedPreference(name: string): Promise<MemoryRecord> {
    // Fresh read: the expected version must be the current one.
    memorySource.invalidate();
    const memory = (await memorySource.list()).find((m) => m.name === name);
    if (memory === undefined) throw new Error(`No memory named ${name}`);
    if (memory.kind !== "preference" || !memory.tags.includes("unconfirmed")) {
      throw new Error(`${name} is not an unconfirmed preference`);
    }
    return memory;
  }

  bb.rpc.register(rpcContract, {
    knowledge_list: async () => {
      const { memories, error } = await memorySource.listOrError();
      if (error !== undefined) logMemoryError(error);
      const { nodes, edges, broken, unconnected } = buildGraph(memories);
      return {
        generatedAt: new Date().toISOString(),
        memories,
        nodes,
        edges,
        broken,
        unconnected,
        ...(error === undefined ? {} : { error }),
      };
    },
    knowledge_get: async ({ name }) => {
      const memories = await memorySource.list();
      const memory = memories.find((m) => m.name === name);
      if (memory === undefined) throw new Error(`No memory named ${name}`);
      // Only an entity lists related threads: nothing else needs them read.
      const candidates = isEntity(memory) ? ((await kanbanCards()) ?? (await openThreads())) : [];
      const detail = knowledgeDetail(memories, name, candidates);
      if (detail === null) throw new Error(`No memory named ${name}`);
      return {
        ...detail,
        relatedThreads: detail.relatedThreads.map(({ threadId, title, column }) => ({
          threadId,
          title,
          column,
        })),
      };
    },
    knowledge_set_notes: async ({ name, notes }) => {
      await writeNotes(memorySource, name, notes);
      return { ok: true as const };
    },
    knowledge_confirm: async ({ name }) => {
      const memory = await unconfirmedPreference(name);
      await memorySource.update({
        id: memory.id,
        expectedVersion: memory.version,
        summary: memory.summary,
        details: memory.details,
        kind: memory.kind,
        tags: memory.tags.filter((tag) => tag !== "unconfirmed"),
        importance: memory.importance,
        pinned: memory.pinned,
      });
      await runDigest();
      return { ok: true as const };
    },
    knowledge_forget: async ({ name }) => {
      const memory = await unconfirmedPreference(name);
      await memorySource.forget(memory.id, memory.version);
      await runDigest();
      return { ok: true as const };
    },
  });
}

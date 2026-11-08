// BB memory as this plugin sees it: reads and writes through the bundled Memory
// plugin's RPC (`listMemories`, `updateMemory`, `deleteMemory`). The Memory
// plugin's output schemas are strict, ours are not: a field it adds later must
// not break the page. Reads are cached for a few seconds; a write drops the
// cache.
import { z } from "zod";

import type { MemoryRecord } from "./knowledge.js";

const MEMORY_PLUGIN = "memory";

const memorySchema = z.looseObject({
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
});

// Records are parsed one by one, so an odd one is skipped, not fatal.
const listSchema = z.looseObject({ memories: z.array(z.unknown()) });
const updateSchema = z.looseObject({ memory: memorySchema });
const deleteSchema = z.looseObject({
  deleted: z.looseObject({ id: z.string(), version: z.number() }),
});

export type CallRpc = <T>(args: {
  pluginId: string;
  method: string;
  input: unknown;
  outputSchema: z.ZodType<T>;
  signal?: AbortSignal;
}) => Promise<T>;

export interface MemoryUpdate {
  id: string;
  expectedVersion: number;
  summary: string;
  details: string;
  kind: string;
  tags: string[];
  importance: number;
  pinned: boolean;
}

export interface MemorySource {
  list(): Promise<MemoryRecord[]>;
  /** Like `list`, but never throws: a failure gives no memories and an `error`. */
  listOrError(): Promise<{ memories: MemoryRecord[]; error?: string }>;
  update(input: MemoryUpdate): Promise<MemoryRecord>;
  forget(id: string, expectedVersion: number): Promise<void>;
  invalidate(): void;
}

/** Keeps the fields of MemoryRecord, so extra fields never travel on. */
function toRecord(m: z.infer<typeof memorySchema>): MemoryRecord {
  return {
    id: m.id,
    scope: m.scope,
    projectId: m.projectId,
    name: m.name,
    summary: m.summary,
    details: m.details,
    kind: m.kind,
    tags: m.tags,
    importance: m.importance,
    pinned: m.pinned,
    version: m.version,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

interface Listing {
  memories: MemoryRecord[];
  /** Records that did not parse and were left out. */
  skipped: number;
}

export function createMemorySource(
  callRpc: CallRpc,
  {
    ttlMs = 5000,
    now = Date.now,
    timeoutMs = 5000,
  }: { ttlMs?: number; now?: () => number; timeoutMs?: number } = {},
): MemorySource {
  let cache: { at: number; listing: Listing } | null = null;
  let inflight: Promise<Listing> | null = null;
  let generation = 0;

  /** The list call, given up after `timeoutMs` so a silent memory plugin cannot hold the board. */
  async function callList(): Promise<z.infer<typeof listSchema>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`the memory plugin timed out after ${timeoutMs} ms`));
        controller.abort();
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        callRpc({
          pluginId: MEMORY_PLUGIN,
          method: "listMemories",
          input: null,
          outputSchema: listSchema,
          signal: controller.signal,
        }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchAll(): Promise<Listing> {
    const started = generation;
    const result = await callList();
    const memories: MemoryRecord[] = [];
    for (const raw of result.memories) {
      const parsed = memorySchema.safeParse(raw);
      if (parsed.success) memories.push(toRecord(parsed.data));
    }
    const listing = { memories, skipped: result.memories.length - memories.length };
    // A write during the call makes this answer stale: use it, do not keep it.
    if (started === generation) cache = { at: now(), listing };
    return listing;
  }

  function invalidate(): void {
    generation += 1;
    cache = null;
    inflight = null;
  }

  async function listing(): Promise<Listing> {
    if (cache !== null && now() - cache.at < ttlMs) return cache.listing;
    if (inflight === null) {
      const call = fetchAll().finally(() => {
        if (inflight === call) inflight = null;
      });
      inflight = call;
    }
    return inflight;
  }

  async function list(): Promise<MemoryRecord[]> {
    return (await listing()).memories;
  }

  return {
    list,
    async listOrError() {
      try {
        const { memories, skipped } = await listing();
        return skipped === 0
          ? { memories }
          : {
              memories,
              error: `Memory partly unavailable: ${skipped} record${skipped === 1 ? "" : "s"} skipped as malformed`,
            };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { memories: [], error: `Memory unavailable: ${reason}` };
      }
    },
    async update(input) {
      try {
        const result = await callRpc({
          pluginId: MEMORY_PLUGIN,
          method: "updateMemory",
          input,
          outputSchema: updateSchema,
        });
        return toRecord(result.memory);
      } finally {
        invalidate();
      }
    },
    async forget(id, expectedVersion) {
      try {
        await callRpc({
          pluginId: MEMORY_PLUGIN,
          method: "deleteMemory",
          input: { id, expectedVersion },
          outputSchema: deleteSchema,
        });
      } finally {
        invalidate();
      }
    },
    invalidate,
  };
}

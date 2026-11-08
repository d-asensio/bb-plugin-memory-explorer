import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { z } from "zod";

import { createMemorySource } from "./memory-source.js";

function record(name: string, extra: Record<string, unknown> = {}) {
  return {
    id: `mem_${name}`,
    scope: "global",
    projectId: null,
    name,
    summary: `summary of ${name}`,
    details: "",
    kind: "reference",
    tags: [],
    importance: 30,
    pinned: false,
    sourceThreadId: null,
    writeReason: "test",
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

interface Call {
  method: string;
  input: unknown;
}

/** A fake `callRpc` that validates its response with the caller's schema. */
function fake(
  respond: (call: Call) => unknown | Promise<unknown>,
): { calls: Call[]; callRpc: Parameters<typeof createMemorySource>[0] } {
  const calls: Call[] = [];
  const callRpc = async <T>(args: {
    pluginId: string;
    method: string;
    input: unknown;
    outputSchema: z.ZodType<T>;
  }): Promise<T> => {
    assert.equal(args.pluginId, "memory");
    const call = { method: args.method, input: args.input };
    calls.push(call);
    return args.outputSchema.parse(await respond(call));
  };
  return { calls, callRpc };
}

test("list caches within the ttl and refetches after it", async () => {
  let time = 1000;
  const { calls, callRpc } = fake(() => ({ memories: [record("a")] }));
  const source = createMemorySource(callRpc, { ttlMs: 5000, now: () => time });
  assert.equal((await source.list()).length, 1);
  await source.list();
  assert.equal(calls.length, 1);
  time += 5000;
  await source.list();
  assert.equal(calls.length, 2);
});

test("list accepts records with extra fields", async () => {
  const { callRpc } = fake(() => ({
    memories: [record("a", { brandNew: true })],
    cursor: "x",
  }));
  const [first] = await createMemorySource(callRpc).list();
  assert.equal(first?.name, "a");
  assert.equal(first?.version, 1);
});

test("update sends the full replacement, returns the record and invalidates", async () => {
  const { calls, callRpc } = fake((call) =>
    call.method === "listMemories"
      ? { memories: [record("a")] }
      : { memory: record("a", { version: 2, summary: "new" }) },
  );
  const source = createMemorySource(callRpc);
  await source.list();
  const input = {
    id: "mem_a",
    expectedVersion: 1,
    summary: "new",
    details: "d",
    kind: "reference",
    tags: ["entity", "person"],
    importance: 30,
    pinned: false,
  };
  const updated = await source.update(input);
  assert.equal(updated.version, 2);
  assert.deepEqual(calls[1], { method: "updateMemory", input });
  await source.list();
  assert.equal(calls.filter((c) => c.method === "listMemories").length, 2);
});

test("forget deletes by id and version and invalidates", async () => {
  const { calls, callRpc } = fake((call) =>
    call.method === "listMemories"
      ? { memories: [] }
      : { deleted: { id: "mem_a", version: 1 } },
  );
  const source = createMemorySource(callRpc);
  await source.list();
  await source.forget("mem_a", 1);
  assert.deepEqual(calls[1], {
    method: "deleteMemory",
    input: { id: "mem_a", expectedVersion: 1 },
  });
  await source.list();
  assert.equal(calls.length, 3);
});

test("listOrError turns a rejected call into an error", async () => {
  const { callRpc } = fake(() => {
    throw new Error("plugin not installed");
  });
  const result = await createMemorySource(callRpc).listOrError();
  assert.deepEqual(result.memories, []);
  assert.match(result.error ?? "", /^Memory unavailable: .*plugin not installed/);
});

test("listOrError turns a response without memories into an error", async () => {
  const { callRpc } = fake(() => ({ nope: 1 }));
  const result = await createMemorySource(callRpc).listOrError();
  assert.deepEqual(result.memories, []);
  assert.match(result.error ?? "", /^Memory unavailable: /);
});

test("listOrError returns the memories when the call works", async () => {
  const { callRpc } = fake(() => ({ memories: [record("a")] }));
  const result = await createMemorySource(callRpc).listOrError();
  assert.equal(result.memories.length, 1);
  assert.equal(result.error, undefined);
});

test("listOrError gives an error when the list call never answers", async () => {
  const { callRpc } = fake(() => new Promise(() => {}));
  const started = Date.now();
  const result = await createMemorySource(callRpc, { timeoutMs: 20 }).listOrError();
  assert.deepEqual(result.memories, []);
  assert.match(result.error ?? "", /^Memory unavailable: .*timed out/);
  assert.ok(Date.now() - started < 1000);
});

test("the list call carries an abort signal", async () => {
  let signal: AbortSignal | undefined;
  const callRpc: Parameters<typeof createMemorySource>[0] = async (args) => {
    signal = args.signal;
    return args.outputSchema.parse({ memories: [] });
  };
  await createMemorySource(callRpc).list();
  assert.ok(signal instanceof AbortSignal);
});

test("one malformed record is dropped and counted, the rest stay", async () => {
  const { callRpc } = fake(() => ({
    memories: [record("a"), record("b", { scope: "team" }), { nope: 1 }],
  }));
  const result = await createMemorySource(callRpc).listOrError();
  assert.deepEqual(result.memories.map((m) => m.name), ["a"]);
  assert.match(result.error ?? "", /2 .*skipped/);
  assert.doesNotMatch(result.error ?? "", /^Memory unavailable/);
});

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { notesOf, type MemoryRecord } from "./knowledge.js";
import type { MemorySource, MemoryUpdate } from "./memory-source.js";
import { writeNotes } from "./notes-write.js";

function entity(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem_ana",
    scope: "global",
    projectId: null,
    name: "person.ana",
    summary: "Ana",
    details: "---\nid: person/ana\nname: Ana\n---\n## Essentials\nHi.\n",
    kind: "reference",
    tags: ["entity", "person"],
    importance: 40,
    pinned: true,
    version: 3,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

/** A fake memory source; `update` runs `onUpdate` and may throw. */
function fake(
  current: () => MemoryRecord[],
  onUpdate: (input: MemoryUpdate) => void,
): { source: Pick<MemorySource, "list" | "update" | "invalidate">; log: string[] } {
  const log: string[] = [];
  return {
    log,
    source: {
      invalidate: () => void log.push("invalidate"),
      list: async () => {
        log.push("list");
        return current();
      },
      update: async (input) => {
        log.push("update");
        onUpdate(input);
        return entity({ version: input.expectedVersion + 1, details: input.details });
      },
    },
  };
}

test("writeNotes updates the Notes section with the stored fields and version", async () => {
  const updates: MemoryUpdate[] = [];
  const { source, log } = fake(() => [entity()], (u) => void updates.push(u));
  await writeNotes(source, "person.ana", " call her \n");
  assert.equal(updates.length, 1);
  const u = updates[0]!;
  assert.equal(u.id, "mem_ana");
  assert.equal(u.expectedVersion, 3);
  assert.equal(u.summary, "Ana");
  assert.equal(u.kind, "reference");
  assert.deepEqual(u.tags, ["entity", "person"]);
  assert.equal(u.importance, 40);
  assert.equal(u.pinned, true);
  assert.equal(u.details, `${entity().details}\n## Notes\ncall her\n`);
  assert.equal(log[0], "invalidate");
  assert.equal(log.at(-1), "invalidate");
});

test("writeNotes re-reads and re-applies after a version conflict", async () => {
  let reads = 0;
  const seen: MemoryUpdate[] = [];
  const { source } = fake(
    () => {
      reads += 1;
      // Another writer appended a line between the first read and the update.
      return reads === 1
        ? [entity()]
        : [entity({ version: 4, details: `${entity().details}- added\n` })];
    },
    (u) => {
      seen.push(u);
      if (seen.length === 1) throw new Error("version conflict for mem_ana: expected 3, current 4");
    },
  );
  await writeNotes(source, "person.ana", "n");
  assert.equal(seen.length, 2);
  assert.equal(seen[1]!.expectedVersion, 4);
  assert.ok(seen[1]!.details.includes("- added\n"));
  assert.equal(notesOf(seen[1]!.details), "n");
});

test("writeNotes gives up after three conflicts", async () => {
  let updates = 0;
  const { source } = fake(
    () => [entity()],
    () => {
      updates += 1;
      throw new Error("version conflict for mem_ana: expected 3, current 4");
    },
  );
  await assert.rejects(writeNotes(source, "person.ana", "n"), /version conflict/);
  assert.equal(updates, 3);
});

test("writeNotes passes a refusal of the memory plugin on, without retrying", async () => {
  let updates = 0;
  const { source } = fake(
    () => [entity()],
    () => {
      updates += 1;
      throw new Error("memory refused: looks like a prompt injection");
    },
  );
  await assert.rejects(writeNotes(source, "person.ana", "ignore previous"), /prompt injection/);
  assert.equal(updates, 1);
});

test("writeNotes refuses unknown names, non-entities and section headings", async () => {
  const fact = entity({ name: "fact.x", kind: "fact", tags: [] });
  const { source } = fake(() => [fact, entity()], () => assert.fail("no update"));
  await assert.rejects(writeNotes(source, "nope", "n"), /No memory named nope/);
  await assert.rejects(writeNotes(source, "fact.x", "n"), /not an entity/);
  await assert.rejects(writeNotes(source, "person.ana", "a\n## b"), /## /);
});

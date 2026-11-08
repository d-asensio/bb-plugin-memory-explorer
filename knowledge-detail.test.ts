import { strict as assert } from "node:assert";
import { test } from "node:test";

import { knowledgeDetail, relatedThreads } from "./knowledge-detail.js";
import type { MemoryRecord } from "./knowledge.js";

function memory(name: string, over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: `mem_${name}`,
    scope: "global",
    projectId: null,
    name,
    summary: `summary of ${name}`,
    details: "",
    kind: "reference",
    tags: ["entity", name.split(".")[0]!],
    importance: 30,
    pinned: false,
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

const ANA = memory("person.ana", {
  details: `---
id: person/ana
name: Ana Ruiz
confidence: high
---
## Essentials
Lead of [[team.core|Core]].

## Relations
- member-of [[team.core|Core]]
`,
});
const CORE = memory("team.core", {
  details: "---\nid: team/core\nname: Core\n---\n## Essentials\nRun by [[person.ana]].\n",
});

const cards = [
  { title: "Call with Ana Ruiz", initiative: null },
  { title: "Other", initiative: null },
];

const ANA_WITH_NOTES = { ...ANA, details: `${ANA.details}\n## Notes\nprivate\n` };

test("knowledgeDetail gathers blocks, relations, backlinks, threads and notes", () => {
  const detail = knowledgeDetail([ANA_WITH_NOTES, CORE], "person.ana", cards);
  assert.ok(detail);
  assert.equal(detail.memory.name, "person.ana");
  assert.equal(detail.type, "person");
  assert.equal(detail.label, "Ana Ruiz");
  assert.deepEqual(detail.relations, [{ type: "member-of", target: "team.core", label: "Core" }]);
  assert.deepEqual(detail.backlinks.map((b) => b.node.name), ["team.core"]);
  assert.deepEqual(detail.relatedThreads, [cards[0]]);
  assert.equal(detail.notes, "private");
  assert.ok(detail.blocks.length > 0);
  // The editor shows the Notes: no block carries them.
  assert.ok(!JSON.stringify(detail.blocks).includes("private"));
  assert.ok(!JSON.stringify(detail.blocks).includes("Notes"));
});

test("knowledgeDetail has empty notes for an entity without a Notes section", () => {
  assert.equal(knowledgeDetail([ANA, CORE], "person.ana", cards)?.notes, "");
});

test("knowledgeDetail has no notes for a non-entity and null for an unknown name", () => {
  const fact = memory("fact.x", { kind: "fact", tags: [] });
  const detail = knowledgeDetail([fact], "fact.x", []);
  assert.equal(detail?.notes, null);
  assert.equal(knowledgeDetail([fact], "nope", []), null);
});

test("knowledgeDetail matches an initiative's threads by its id", () => {
  const initiative = memory("initiative.fire", {
    details: "---\nid: initiative/fire\nname: Fire\n---\n",
  });
  const mine = { title: "Anything", initiative: "fire" };
  const detail = knowledgeDetail([initiative], "initiative.fire", [mine, cards[1]!]);
  assert.deepEqual(detail?.relatedThreads, [mine]);
});

test("relatedThreads: initiative slug or name in the title", () => {
  const cards = [
    { title: "[firefighting] OPS-1 fix", initiative: "firefighting" },
    { title: "Chat about Firefighting (Core)", initiative: null },
    { title: "Unrelated", initiative: "other" },
  ];
  const initiative = { id: "initiative/firefighting", kind: "initiative", name: "Firefighting (Core)" };
  assert.deepEqual(relatedThreads(initiative, cards), cards.slice(0, 2));
  // Only initiatives match on the initiative field.
  const person = { id: "person/firefighting", kind: "person", name: "Nobody" };
  assert.deepEqual(relatedThreads(person, cards), []);
  const jonas = { id: "person/jonas", kind: "person", name: "Jonas" };
  assert.deepEqual(
    relatedThreads(jonas, [{ title: "1:1 with jonas", initiative: null }]).length,
    1,
  );
});

test("relatedThreads: the name must be a whole word", () => {
  const ana = { id: "person/ana", kind: "person", name: "Ana" };
  const cards = [
    { title: "Analytics dashboard", initiative: null },
    { title: "Call with Ana tomorrow", initiative: null },
    { title: "Reunión con Anaïs", initiative: null },
    { title: "ana: follow up", initiative: null },
  ];
  assert.deepEqual(relatedThreads(ana, cards), [cards[1], cards[3]]);
  // Regex metacharacters in a name are literal.
  const close = { id: "initiative/x", kind: "initiative", name: "Firefighting (Core)" };
  assert.deepEqual(
    relatedThreads(close, [{ title: "About Firefighting (Core) now", initiative: null }]).length,
    1,
  );
});

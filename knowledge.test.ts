import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  backlinks,
  buildGraph,
  detailsToBlocks,
  entityFields,
  isEntity,
  localGraph,
  matchesQuery,
  memoryLabel,
  memoryType,
  notesOf,
  parseLinks,
  parseRelations,
  setNotesSection,
  stripLinks,
  withoutNotesSection,
  type MemoryRecord,
} from "./knowledge.js";

let counter = 0;
function memory(
  name: string,
  over: Partial<MemoryRecord> & { details?: string } = {},
): MemoryRecord {
  counter += 1;
  return {
    id: `mem_${counter}`,
    scope: "global",
    projectId: null,
    name,
    summary: `summary of ${name}`,
    details: "",
    kind: "reference",
    tags: [],
    importance: 30,
    pinned: false,
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function entity(name: string, type: string, body: string, front = ""): MemoryRecord {
  const [, slug = name] = name.split(".");
  return memory(name, {
    tags: ["entity", type],
    details: `---\nid: ${type}/${slug}\nname: ${slug.toUpperCase()}\n${front}---\n${body}`,
  });
}

function fixture(): MemoryRecord[] {
  return [
    entity(
      "person.a",
      "person",
      "## Relations\n- member of [[team.t|T]]\n\n## Timeline\n- 2026-11-03 met [[person.b|B]]\n",
    ),
    entity("team.t", "team", "## Essentials\nA team.\n"),
    entity("person.b", "person", "## Essentials\nB.\n"),
    entity("person.c", "person", "## Essentials\nNo links.\n"),
    memory("pref.code.x", {
      kind: "preference",
      tags: ["code"],
      details: "Ask [[person.a|A]] about [[missing.z]].",
    }),
    memory("pref.digest", {
      kind: "preference",
      tags: ["digest"],
      details: "- [[pref.code.x]]",
    }),
  ];
}

test("parseLinks returns each link with target, label and index", () => {
  const text = "a [[x.y|B c]] d [[e.f]]";
  assert.deepEqual(parseLinks(text), [
    { target: "x.y", label: "B c", index: 2 },
    { target: "e.f", label: null, index: 16 },
  ]);
});

test("parseLinks ignores text that is not a link", () => {
  assert.deepEqual(parseLinks("[[Bad Name]] [x.y] [[x.y|]] [[-x]]"), []);
});

test("parseRelations reads only lines that are exactly a typed link", () => {
  const section = "- member of [[team.core|Core]]\n- uses [[integration.whatsapp]]\ntext [[x.y]]";
  assert.deepEqual(parseRelations(section), [
    { type: "member of", target: "team.core", label: "Core" },
    { type: "uses", target: "integration.whatsapp", label: null },
  ]);
});

test("stripLinks keeps the label, else the target", () => {
  assert.equal(stripLinks("a [[x.y|B c]] d [[e.f]]"), "a B c d e.f");
});

test("buildGraph: edges, broken links, unconnected entities, no digest node", () => {
  const g = buildGraph(fixture());
  assert.deepEqual(
    g.edges.map((e) => [e.source, e.target, e.type, e.relation]),
    [
      ["person.a", "team.t", "relation", "member of"],
      ["person.a", "person.b", "mention", undefined],
      ["pref.code.x", "person.a", "mention", undefined],
    ],
  );
  assert.deepEqual(g.broken, [{ source: "pref.code.x", target: "missing.z" }]);
  assert.deepEqual(g.unconnected, ["person.c"]);
  assert.equal(g.nodes.some((n) => n.name === "pref.digest"), false);
  assert.equal(g.nodes.length, 5);
});

test("buildGraph: a relation beats a mention of the same pair, once", () => {
  const g = buildGraph([
    entity("person.a", "person", "## Relations\n- uses [[team.t]]\n\n## Context\nsee [[team.t]] and [[team.t]]\n"),
    entity("team.t", "team", ""),
  ]);
  assert.deepEqual(g.edges, [
    { source: "person.a", target: "team.t", type: "relation", relation: "uses" },
  ]);
});

test("buildGraph: node fields and degree", () => {
  const g = buildGraph(fixture());
  const a = g.nodes.find((n) => n.name === "person.a")!;
  assert.equal(a.degree, 3);
  assert.equal(a.type, "person");
  assert.equal(a.label, "A");
  assert.equal(a.id, "person/a");
  assert.equal(a.summary, "summary of person.a");
  const pref = g.nodes.find((n) => n.name === "pref.code.x")!;
  assert.equal(pref.type, "preference");
  assert.equal(pref.degree, 1);
  assert.equal(pref.unconfirmed, false);
});

test("buildGraph: links in front matter are not mentions", () => {
  const g = buildGraph([
    entity("person.a", "person", "", "links: { notes: https://x.com/[[team.t]] }\n"),
    entity("team.t", "team", ""),
  ]);
  assert.deepEqual(g.edges, []);
});

test("localGraph: one and two hops around a node", () => {
  const g = buildGraph(fixture());
  const one = localGraph(g, "person.b", 1);
  assert.deepEqual(one.nodes.map((n) => n.name), ["person.b", "person.a"]);
  assert.deepEqual(one.edges.map((e) => e.source + ">" + e.target), ["person.a>person.b"]);
  const two = localGraph(g, "person.b", 2);
  assert.deepEqual(new Set(two.nodes.map((n) => n.name)), new Set(["person.b", "person.a", "team.t", "pref.code.x"]));
  assert.equal(two.edges.length, 3);
  assert.deepEqual(localGraph(g, "nope", 1), { nodes: [], edges: [] });
});

test("backlinks lists who points at a node", () => {
  const g = buildGraph(fixture());
  assert.deepEqual(
    backlinks(g, "person.a").map((b) => [b.node.name, b.type]),
    [["pref.code.x", "mention"]],
  );
  assert.deepEqual(backlinks(g, "person.c"), []);
});

test("detailsToBlocks: memory links and URLs become segments", () => {
  const details = "---\nid: person/a\n---\n## Timeline\n- met [[person.b|B]] (https://x)\nplain [[team.t]]\n";
  assert.deepEqual(detailsToBlocks(details), [
    { type: "heading", text: "Timeline" },
    {
      type: "bullet",
      segments: [
        { text: "met " },
        { text: "B", memory: "person.b" },
        { text: " (" },
        { text: "x", href: "https://x" },
        { text: ")" },
      ],
    },
    { type: "text", segments: [{ text: "plain " }, { text: "team.t", memory: "team.t" }] },
  ]);
});

test("detailsToBlocks: details without front matter are all body", () => {
  assert.deepEqual(detailsToBlocks("- one"), [
    { type: "bullet", segments: [{ text: "one" }] },
  ]);
});

test("entityFields reads aliases, links, match and status from front matter", () => {
  const m = entity(
    "person.a",
    "person",
    "",
    "aliases: [Ann, A.]\nlinks: { email: a@x.com, slack: U1 }\nconfidence: high\nstatus: active\nmatch: { sections: [s1], titlePrefixes: [] }\n",
  );
  assert.deepEqual(entityFields(m), {
    id: "person/a",
    type: "person",
    name: "A",
    aliases: ["Ann", "A."],
    links: { email: "a@x.com", slack: "U1" },
    confidence: "high",
    status: "active",
    match: { sections: ["s1"], titlePrefixes: [] },
  });
});

test("entityFields: null for non-entities and unparseable front matter", () => {
  assert.equal(entityFields(fixture()[4]!), null);
  assert.equal(entityFields(memory("person.x", { tags: ["entity", "person"], details: "no front matter" })), null);
});

test("memoryType: entity type, else kind; an unconfirmed preference is a preference", () => {
  const [a, , , , pref] = fixture();
  assert.equal(memoryType(a!), "person");
  assert.equal(memoryType(pref!), "preference");
  const unconfirmed = memory("pref.code.y", { kind: "preference", tags: ["code", "unconfirmed"] });
  assert.equal(memoryType(unconfirmed), "preference");
  assert.equal(isEntity(a!), true);
  assert.equal(isEntity(pref!), false);
  assert.equal(buildGraph([unconfirmed]).nodes[0]!.unconfirmed, true);
});

test("memoryLabel: entity name, else memory name", () => {
  const [a, , , , pref] = fixture();
  assert.equal(memoryLabel(a!), "A");
  assert.equal(memoryLabel(pref!), "pref.code.x");
});

test("matchesQuery looks at name, label, aliases, email, Slack id and summary", () => {
  const m = entity("person.pawel-pohl", "person", "", "aliases: [Paulo]\nlinks: { email: p@x.com, slack: U9XYZ }\n");
  for (const q of ["pawel-pohl", "PAWEL-POHL", "paulo", "p@x.com", "u9xyz", "summary of", "  "]) {
    assert.equal(matchesQuery(m, q), true, q);
  }
  assert.equal(matchesQuery(m, "nobody"), false);
  assert.equal(matchesQuery(m, ""), true);
});

test("a memory is an entity only when its name starts with its type", () => {
  const stray = memory("x.y", {
    tags: ["entity", "person"],
    details: "---\nid: person/y\nname: Y\n---\n",
  });
  assert.equal(isEntity(stray), false);
  assert.equal(entityFields(stray), null);
  assert.equal(memoryType(stray), "reference");
  const mismatch = memory("team.y", { tags: ["entity", "person"], details: "---\nname: Y\n---\n" });
  assert.equal(isEntity(mismatch), true);
  assert.equal(memoryType(mismatch), "team");
});

test("buildGraph: a link to the digest is neither an edge nor broken", () => {
  const g = buildGraph([
    memory("pref.code.x", { kind: "preference", tags: ["code"], details: "see [[pref.digest]]" }),
    memory("pref.digest", { kind: "preference", tags: ["digest"], details: "" }),
  ]);
  assert.deepEqual(g.edges, []);
  assert.deepEqual(g.broken, []);
});

test("front matter closes at an exact --- line, not at ----", () => {
  const m = memory("person.ana", {
    tags: ["entity", "person"],
    details: "---\nid: person/ana\nname: Ana\n---\n## Essentials\nbody\n----\nmore [[team.core]]\n",
  });
  assert.equal(entityFields(m)?.name, "Ana");
  const links = buildGraph([m, memory("team.core", { tags: ["entity", "team"] })]).edges;
  assert.equal(links.length, 1);
  const tricky = memory("person.bo", {
    tags: ["entity", "person"],
    details: "---\nid: person/bo\nname: Bo\n----\nstill front matter?\n---\nbody\n",
  });
  // parseFrontMatter treats "----" as a value line and fails; so does splitting.
  assert.equal(entityFields(tricky), null);
});

// ---- Notes -----------------------------------------------------------------

const BASE = "---\nid: person/a\nname: A\n---\n## Essentials\nText.\n\n## Timeline\n- one\n";

test("notesOf reads the Notes section, empty when missing", () => {
  assert.equal(notesOf(BASE), "");
  assert.equal(notesOf(`${BASE}\n## Notes\nfirst\nsecond\n`), "first\nsecond");
  assert.equal(notesOf(`${BASE}\n## Notes\nmid\n\n## After\nx\n`), "mid");
});

test("setNotesSection appends the section when missing", () => {
  assert.equal(setNotesSection(BASE, "  hello \n"), `${BASE}\n## Notes\nhello\n`);
  assert.equal(setNotesSection("x", "y"), "x\n\n## Notes\ny\n");
});

test("setNotesSection replaces the section and leaves the rest byte for byte", () => {
  const before = `${BASE}\n## Notes\nold\n`;
  assert.equal(setNotesSection(before, "new"), `${BASE}\n## Notes\nnew\n`);
  const middle = "a\r\n## Notes\r\nold\r\n\n## After\nkeep\n";
  const out = setNotesSection(middle, "new");
  assert.equal(out, "a\r\n## Notes\r\nnew\n\n## After\nkeep\n");
  assert.equal(notesOf(out), "new");
});

test("setNotesSection with empty notes leaves an empty section", () => {
  assert.equal(setNotesSection(`${BASE}\n## Notes\nold\n`, " \n"), `${BASE}\n## Notes\n`);
  assert.equal(notesOf(setNotesSection(BASE, "")), "");
});

test("setNotesSection refuses text with a section heading", () => {
  assert.throws(() => setNotesSection(BASE, "a\n## Sneaky\nb"), /## /);
  assert.equal(setNotesSection(BASE, "### fine"), `${BASE}\n## Notes\n### fine\n`);
});

test("withoutNotesSection drops the section only", () => {
  assert.equal(withoutNotesSection(`${BASE}\n## Notes\nx\n`), `${BASE}\n`);
  assert.equal(withoutNotesSection(BASE), BASE);
});

test("parseRelations makes runs of spaces in a type one", () => {
  assert.deepEqual(parseRelations("-   led   to  [[procedure.replay]]"), [
    { type: "led to", target: "procedure.replay", label: null },
  ]);
});

test("buildGraph: any memory, not only an entity, has typed relations, both ways", () => {
  const g = buildGraph([
    memory("episode.outage", {
      kind: "episode",
      details:
        "Webhooks failed after a key rotation; [[person.a|A]] rolled it back.\n\n## Relations\n- led to [[procedure.rotate|Key rotation]]\n- involved [[person.a|A]]\n",
    }),
    memory("procedure.rotate", {
      kind: "procedure",
      details: "Accept both keys for a day.\n\n## Relations\n- based on [[episode.outage]]\n",
    }),
    entity("person.a", "person", "## Essentials\nOn call.\n"),
  ]);
  assert.deepEqual(
    g.edges.map((e) => [e.source, e.target, e.type, e.relation]),
    [
      ["episode.outage", "procedure.rotate", "relation", "led to"],
      // The relation wins over the mention of the same memory in the text.
      ["episode.outage", "person.a", "relation", "involved"],
      ["procedure.rotate", "episode.outage", "relation", "based on"],
    ],
  );
  assert.deepEqual(
    backlinks(g, "episode.outage").map((b) => [b.node.name, b.type, b.relation]),
    [["procedure.rotate", "relation", "based on"]],
  );
});

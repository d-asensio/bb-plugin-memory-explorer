import { strict as assert } from "node:assert";
import { test } from "node:test";

import { parseFrontMatter } from "./frontmatter.js";

test("parseFrontMatter reads scalars, lists, maps and flow lists in maps", () => {
  const data = parseFrontMatter(
    [
      "---",
      "id: person/a",
      "aliases: [Ann, 'A. B']",
      "links: { email: a@x.com, slack: U1 }",
      "match: { sections: [s1, s2], bbProjects: [] }",
      "---",
      "body",
    ].join("\n"),
  );
  assert.equal(data.id, "person/a");
  assert.deepEqual(data.aliases, ["Ann", "A. B"]);
  assert.deepEqual(data.links, { email: "a@x.com", slack: "U1" });
  assert.deepEqual(data.match, { sections: ["s1", "s2"], bbProjects: [] });
});

test("parseFrontMatter rejects text without a closed front matter block", () => {
  assert.throws(() => parseFrontMatter("no front matter"), /missing opening/);
  assert.throws(() => parseFrontMatter("---\nid: x\n"), /missing closing/);
});

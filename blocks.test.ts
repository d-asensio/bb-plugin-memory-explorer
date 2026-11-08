import { strict as assert } from "node:assert";
import { test } from "node:test";

import { bodyToBlocks, linkify } from "./blocks.js";

test("linkify: parenthesised URLs show their host, bare URLs themselves", () => {
  assert.deepEqual(linkify("Meeting (https://www.google.com/calendar/event?eid=x&ctz=Europe/Madrid)"), [
    { text: "Meeting (" },
    { text: "www.google.com", href: "https://www.google.com/calendar/event?eid=x&ctz=Europe/Madrid" },
    { text: ")" },
  ]);
  assert.deepEqual(linkify("See https://linear.app/a/b. Then"), [
    { text: "See " },
    { text: "https://linear.app/a/b", href: "https://linear.app/a/b" },
    { text: ". Then" },
  ]);
  assert.deepEqual(linkify("no links here"), [{ text: "no links here" }]);
});

test("bodyToBlocks: headings, bullets and text, skipping blank lines", () => {
  const blocks = bodyToBlocks(
    [
      "## Essentials",
      "",
      "Lead of Core.",
      "## Timeline",
      "- 2026-11-03 Meeting (https://cal.example/e)",
      "* starred",
      "### not a section",
    ].join("\n"),
  );
  assert.deepEqual(blocks, [
    { type: "heading", text: "Essentials" },
    { type: "text", segments: [{ text: "Lead of Core." }] },
    { type: "heading", text: "Timeline" },
    {
      type: "bullet",
      segments: [
        { text: "2026-11-03 Meeting (" },
        { text: "cal.example", href: "https://cal.example/e" },
        { text: ")" },
      ],
    },
    { type: "bullet", segments: [{ text: "starred" }] },
    { type: "text", segments: [{ text: "### not a section" }] },
  ]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { ENTITY_TYPES, KIND_TYPES } from "./knowledge.js";
import { conceptSummary, conceptTitle, relativeDay, typeColor, typeIconSvg, typeStyle } from "./type-style.js";

test("typeStyle: every known type has its own icon and colour", () => {
  const types = [...ENTITY_TYPES, ...KIND_TYPES];
  const icons = new Set(types.map((t) => typeStyle(t).icon));
  const colors = new Set(types.map((t) => typeStyle(t).light));
  assert.equal(icons.size, types.length);
  assert.equal(colors.size, types.length);
  for (const t of types) assert.notEqual(typeStyle(t).label.toLowerCase(), "unknown");
});

test("typeStyle: person is a blue user icon, meeting an orange calendar", () => {
  assert.equal(typeStyle("person").label, "Person");
  assert.match(typeStyle("person").icon, /circle cx="12" cy="8"/);
  assert.equal(typeColor("meeting", false), "#ea580c");
  assert.match(typeStyle("meeting").icon, /rect width="18" height="18"/);
});

test("typeStyle: an unknown type is capitalised with a neutral dot", () => {
  const style = typeStyle("gadget");
  assert.equal(style.label, "Gadget");
  assert.equal(style.light, "#737373");
  assert.equal(typeStyle("").label, "Unknown");
});

test("typeColor: dark mode uses the lighter shade", () => {
  assert.equal(typeColor("person", true), "#60a5fa");
});

test("typeIconSvg: a standalone SVG stroked in the given colour", () => {
  const svg = typeIconSvg("person", "#fff");
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /stroke="#fff"/);
});

test("relativeDay: today, yesterday, days, then a date", () => {
  const now = Date.UTC(2026, 10, 6, 12);
  assert.equal(relativeDay(now - 3_600_000, now), "today");
  assert.equal(relativeDay(now - 30 * 3_600_000, now), "yesterday");
  assert.equal(relativeDay(now - 5 * 86_400_000, now), "5d ago");
  assert.match(relativeDay(now - 90 * 86_400_000, now), /2026/);
});

test("conceptTitle: entities keep their label, other memories lose the kind prefix", () => {
  assert.equal(conceptTitle("Phil Andrews", "person.phil-andrews"), "Phil Andrews");
  assert.equal(
    conceptTitle("proc.check-what-reached-production", "proc.check-what-reached-production"),
    "Check what reached production",
  );
  assert.equal(conceptTitle("pref.communication.slack-voice", "pref.communication.slack-voice"), "Communication slack voice");
  assert.equal(conceptTitle("pref.digest", "pref.digest"), "Digest");
  assert.equal(conceptTitle("plain", "plain"), "Plain");
});

test("conceptSummary: drops the leading 'Label (type) —', keeps anything else", () => {
  assert.equal(
    conceptSummary("Phil Andrews (person) — Head of CX (Slack profile)", "Phil Andrews", "person"),
    "Head of CX (Slack profile)",
  );
  assert.equal(conceptSummary("Head of CX", "Phil Andrews", "person"), "Head of CX");
  assert.equal(conceptSummary("Phil Andrews (person)", "Phil Andrews", "person"), "Phil Andrews (person)");
});

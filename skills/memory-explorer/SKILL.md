---
name: memory-explorer
description: How the Memory Explorer page shows BB memory, how to link memories with typed relations, and the Notes rule. Read before writing or editing any memory meant to show on the page (an entity such as a person, company, team, system, integration, meeting or initiative, or an episode, procedure, decision, fact or preference), its `[[links]]` or `## Relations`, or a memory's `## Notes` section.
---

# Memory Explorer

The user browses BB memory on the Memory Explorer page: a table, a drawer per
memory and a link graph. The plugin has no agent tool or command; read and
write memory as you otherwise would (`bb memory …`, or the tool your host
provides for it).

## Never write Notes

The `## Notes` section of an entity memory is the user's own text, edited only
on the page. Read it for context; never add, change or remove it, and keep it
the last section when you update the rest of the memory.

## Write memories the page can show

- An entity is a memory of kind `reference`, tagged `entity` and its type,
  named `<type>.<slug>`: `person`, `company`, `team`, `system`, `integration`,
  `meeting`, `initiative` or `other`. Start its details with front matter
  (`id`, `name`, `aliases: [..]`, `links: { email: .., slack: .., <name>: <url> }`,
  `confidence`), then `## ` sections.
- Link to another memory with `[[memory-name]]` or `[[memory-name|label]]`.
  A link to a name no memory has shows as a broken link.
- Tag a preference you inferred but the user has not stated `unconfirmed`:
  the page offers Confirm and Discard for it.
- Memories tagged `digest` are left out of the table and the graph.

## Say how memories relate

A link alone only says that two memories are connected. Say how, in a
`## Relations` section of lines `- <relation> [[memory-name]]` (or
`[[memory-name|label]]`): the graph draws each line as an arrow from this
memory to the one named, labelled with the relation. Any memory can have the
section, not only an entity; in an entity it comes before `## Notes`.

- Write the relation as a few lower-case words that read "this memory
  *relation* that one": `- led to [[procedure.key-rotation]]` in an episode,
  `- based on [[episode.billing-webhook-outage]]` in the procedure.
- One line per memory related; a line that is not exactly a relation and one
  link is ignored, and only the first relation to a memory counts.
- When you write a memory that came out of another (a procedure or decision
  from an episode, a fact learned in one), add the relation on both: what it
  led to on the earlier memory, where it came from on the new one.

Relations that read well:

| From | Relations |
| --- | --- |
| an entity | `member of`, `owns`, `uses`, `works on`, `reports to`, `escalates to`, `about` |
| an episode | `led to`, `involved`, `affected`, `caused by` |
| a procedure or decision | `based on`, `applies to`, `replaces`, `part of` |
| a fact | `about`, `learned in` |
| anything | `related to`, when no word above fits |

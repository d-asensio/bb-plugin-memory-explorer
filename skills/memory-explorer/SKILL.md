---
name: memory-explorer
description: How the Memory Explorer page shows BB memory, and the Notes rule. Read before writing or editing an entity memory (a person, company, team, system, integration, meeting or initiative) or a memory's `## Notes` section.
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
  Under `## Relations`, a line `- <relation> [[memory-name]]` is a typed
  relation. A link to a name no memory has shows as a broken link.
- Tag a preference you inferred but the user has not stated `unconfirmed`:
  the page offers Confirm and Discard for it.
- Memories tagged `digest` are left out of the table and the graph.

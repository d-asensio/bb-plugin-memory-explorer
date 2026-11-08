# Memory Explorer

A [bb](https://getbb.app) plugin that shows what your agents remember: BB memory
as a searchable table and a zoomable link graph, with a detail drawer for each
memory.

## Install

From the plugin store in bb, or from this repository:

```sh
bb plugin install git:https://github.com/d-asensio/bb-plugin-memory-explorer.git@^0.1.0
```

It needs BB 0.48 or later and BB's own Memory plugin, which ships with BB but
is not installed by default (`bb plugin install memory`, or **Memory** in the
plugin store). Memory Explorer stores nothing of its own: it reads and writes
memories through the Memory plugin's RPC.

## What it shows

A **Memory** page in the sidebar (`/plugins/memory-explorer/memory`):

- **Table**: every global and project memory, each type with its own icon and
  colour. Sort by any column, filter by type, and search names, aliases, email
  addresses, Slack ids and summaries.
- **Drawer**: a clicked row or graph node opens the memory. Its `[[links]]`
  open the memory they name; below come the memories that link to it, a small
  graph of its neighbours (pinch or use + and − to zoom it), and for an entity,
  the threads whose title names it and its Notes.
- **Graph**: every memory and link on a canvas. Scroll or use + and − to zoom,
  drag the background to pan, drag a node to pin it, double-click a pinned node
  to release it. A relation is an arrow labelled with its type (`member of`,
  `led to`): the labels show for the memory you point at or open, and for every
  relation once you zoom in or the graph is small. Dashed lines are mentions.
  When two memories link both ways, the two lines bend apart. A memory opened
  from the graph shows in the drawer beside it: the zoom buttons move clear of
  the drawer, and a memory under it is panned into view. Unconnected entities
  and broken links are listed below the canvas.
- **Preferences** of kind `preference` tagged `unconfirmed` get **Confirm**
  (removes the tag) and **Discard** (deletes the memory).

Memories tagged `digest` stay out of the table and the graph. Nothing watches
memory: **Refresh** reads it again.

## Entity memories

A memory is an *entity* when its kind is `reference`, it is tagged `entity`
and its type, and its name is `<type>.<slug>`. The types are `person`,
`company`, `team`, `system`, `integration`, `meeting`, `initiative` and
`other`. Every other memory is shown by its kind (`preference`, `decision`,
`procedure`, `fact`, `episode`, `reference`).

An entity's details start with front matter, one `key: value` per line, then
`## ` sections:

```markdown
---
id: person/ana
name: Ana Ruiz
aliases: [Ana]
links: { email: ana@example.com, slack: U012AB3CD, linear: https://linear.app/acme/profiles/ana }
confidence: high
status: active
---
## Essentials
Leads [[team.core|the Core team]] and owns [[system.billing]].

## Relations
- member-of [[team.core|Core]]
- owns [[system.billing]]

## Notes
Prefers written updates to meetings.
```

- `name` is the label the page shows; `aliases`, `links.email` and
  `links.slack` are searched. Every `links` entry becomes a chip, which opens
  its URL, or writes an email for an email address.
- `[[name]]` or `[[name|label]]` anywhere in the text links to another memory,
  and `## Relations` says how the entity relates to it (next section).
- `## Notes` is the user's own text, edited on the page. Keep it the last
  section. Agents may read it but should not write it.

## Links and relations

Every memory, entity or not, can link to other memories and say how it
relates to them:

- `[[name]]` or `[[name|label]]` anywhere in the text is a *mention*: a dashed
  line in the graph.
- A `## Relations` section of lines `- <relation> [[name]]` (or
  `[[name|label]]`) holds *typed relations*: arrows from this memory to the one
  named, labelled with the relation. The relation is free text, a few words
  that read as "this memory *relation* that one". A relation beats a mention of
  the same memory, and the first relation to a memory is the one shown.

So an episode can say what came of it, and the procedure it led to where it
came from. In `episode.billing-webhook-outage`:

```markdown
Stripe webhooks failed for two hours after a key rotation; [[person.ana|Ana]] rolled it back.

## Relations
- led to [[procedure.key-rotation|Key rotation]]
- involved [[person.ana|Ana Ruiz]]
- affected [[system.billing|Billing service]]
```

and in `procedure.key-rotation`:

```markdown
Rotate the signing key with both keys accepted for a day.

## Relations
- based on [[episode.billing-webhook-outage|Billing webhook outage]]
- applies to [[system.billing|Billing service]]
```

Relations that read well: between entities `member of`, `owns`, `uses`,
`works on`, `reports to`, `escalates to`; from an episode `led to`,
`involved`, `affected`; from a procedure or a decision `based on`,
`applies to`, `replaces`; from a fact `about`, `learned in`. Any other words
work too. Memories written before 0.2.0 need no change: their `## Relations`
lines are the same relations, now drawn with their labels.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `digestCommand` | empty | Runs after a preference is confirmed or discarded, for example a script that rebuilds a digest of your preferences. A program or script and its arguments, run without a shell; put a path with spaces in double quotes. A `.js`, `.mjs` or `.cjs` script runs with Node, and `BB_CLI` names the bb command. A failure is logged and never undoes the confirm. |

```sh
bb plugin config memory-explorer set digestCommand "/path/to/rebuild-digest.mjs --quiet"
```

## Related threads

An entity's drawer lists the open threads whose title contains its name as a
whole word. When a plugin with the id `kanban` answers a `board_get` RPC with
`columns` and `cards` (`threadId`, `title`, `column`, `initiative`), the drawer
lists that board's cards instead, with their column, and an initiative's drawer
also lists the cards filed under it.

## Develop

```sh
npm install --include=dev
npm test             # unit tests (node:test, compiled with tsc)
npm run typecheck
bb plugin install .  # registers this folder
bb plugin dev        # rebuilds and reloads on save
```

- `server.ts`: settings, the `knowledge_*` RPC methods, related threads and
  the digest command.
- `memory-source.ts`: reads and writes memory through the Memory plugin's
  `listMemories`, `updateMemory` and `deleteMemory`.
- `knowledge.ts`: entity fields, `[[links]]`, relations of every memory, Notes,
  the graph.
  `knowledge-detail.ts`: what the drawer shows. `blocks.ts`: text as display
  blocks. `frontmatter.ts`: the front matter subset. `notes-write.ts`: Notes,
  retried on a version conflict. `digest-command.ts`: the digest command.
- `app.tsx` and `pages/`: the page (`MemoryPage.tsx`), the drawer
  (`MemoryDetail.tsx`), the canvas (`GraphView.tsx`, geometry in
  `graph-layout.ts`) and type icons (`TypeIcon.tsx`, `type-style.ts`).

## License

[MIT](LICENSE)

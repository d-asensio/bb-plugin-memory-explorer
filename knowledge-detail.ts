// What the drawer shows for one memory: its display blocks, typed relations,
// backlinks, the threads about it, and the Notes of an entity.
//
// No Node imports: the page bundles this module too.
import {
  backlinks,
  buildGraph,
  detailsToBlocks,
  entityFields,
  entityRelations,
  isEntity,
  memoryLabel,
  memoryType,
  notesOf,
  withoutNotesSection,
  type Backlink,
  type MemoryRecord,
  type Relation,
} from "./knowledge.js";
import type { Block } from "./blocks.js";

/** The thread fields `relatedThreads` looks at. */
export interface RelatedThreadFields {
  title: string;
  /** The thread's initiative slug, when a board files threads under initiatives. */
  initiative: string | null;
}

/** The slug half of an id: `initiative/firefighting` → `firefighting`. */
function slugOf(id: string): string {
  return id.slice(id.indexOf("/") + 1);
}

/** `text` with every RegExp metacharacter escaped. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Threads that belong to an entity (`id` is `<type>/<slug>`, `kind` its type):
 * for an initiative, threads whose `initiative` is its slug; for any entity,
 * threads whose title contains its name as a whole word (case-insensitive,
 * Unicode letters and digits count as word characters). Thread order is kept.
 */
export function relatedThreads<Thread extends RelatedThreadFields>(
  item: { id: string; kind: string; name: string },
  threads: readonly Thread[],
): Thread[] {
  const slug = slugOf(item.id);
  const name = item.name.trim();
  // The name as a whole word: "Ana" matches "Call with Ana", not "Analytics".
  const pattern =
    name === ""
      ? null
      : new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "iu");
  return threads.filter(
    (thread) =>
      (item.kind === "initiative" && thread.initiative === slug) ||
      (pattern !== null && pattern.test(thread.title)),
  );
}

export interface KnowledgeDetail<Thread> {
  memory: MemoryRecord;
  type: string;
  label: string;
  blocks: Block[];
  relations: Relation[];
  backlinks: Backlink[];
  relatedThreads: Thread[];
  /** The entity's Notes (its `## Notes` section; empty string when none); null for other memories. */
  notes: string | null;
}

/** The detail of the memory called `name`, or null when there is none. */
export function knowledgeDetail<Thread extends RelatedThreadFields>(
  memories: readonly MemoryRecord[],
  name: string,
  threads: readonly Thread[],
): KnowledgeDetail<Thread> | null {
  const memory = memories.find((m) => m.name === name);
  if (memory === undefined) return null;
  const entity = isEntity(memory);
  const type = memoryType(memory);
  const fields = entityFields(memory);
  return {
    memory,
    type,
    label: memoryLabel(memory),
    // The Notes editor shows the Notes section: no block carries it.
    blocks: detailsToBlocks(entity ? withoutNotesSection(memory.details) : memory.details),
    relations: entity ? entityRelations(memory) : [],
    backlinks: backlinks(buildGraph(memories), name),
    // The slug half of the id is what a thread's `initiative` holds.
    relatedThreads: entity
      ? relatedThreads(
          {
            id: `${type}/${(fields?.id ?? name).replace(/^[a-z]+\//, "")}`,
            kind: type,
            name: memoryLabel(memory),
          },
          threads,
        )
      : [],
    notes: entity ? notesOf(memory.details) : null,
  };
}

// Writing Notes: the `## Notes` section of an entity memory's details.
// A read-modify-write over the memory source, retried on a version conflict.
import { isEntity, setNotesSection } from "./knowledge.js";
import type { MemorySource } from "./memory-source.js";

const MAX_ATTEMPTS = 3;

const isConflict = (error: unknown): boolean =>
  error instanceof Error && /version conflict/i.test(error.message);

/**
 * Sets the Notes of the entity `name`. Reads the latest memory, replaces the
 * section and updates with the stored fields and `expectedVersion`; a version
 * conflict re-reads and re-applies (at most 3 attempts). Any other failure, a
 * refusal of the memory plugin included, is thrown as it is.
 */
export async function writeNotes(
  source: Pick<MemorySource, "list" | "update" | "invalidate">,
  name: string,
  notes: string,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    source.invalidate();
    const memory = (await source.list()).find((m) => m.name === name);
    if (memory === undefined) throw new Error(`No memory named ${name}`);
    if (!isEntity(memory)) throw new Error(`${name} is not an entity: no Notes`);
    const details = setNotesSection(memory.details, notes);
    try {
      await source.update({
        id: memory.id,
        expectedVersion: memory.version,
        summary: memory.summary,
        details,
        kind: memory.kind,
        tags: memory.tags,
        importance: memory.importance,
        pinned: memory.pinned,
      });
      return;
    } catch (error) {
      if (!isConflict(error) || attempt >= MAX_ATTEMPTS) throw error;
    } finally {
      source.invalidate();
    }
  }
}

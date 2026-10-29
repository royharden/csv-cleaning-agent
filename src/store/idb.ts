import { openDB, type DBSchema } from 'idb';
import type { ParseMeta } from '../core/csv/parse.ts';
import type { Table, ColumnId } from '../core/table.ts';
import type { JournalEvent } from '../core/journal/events.ts';
import type { Decision } from '../core/review/state.ts';
import type { Ruling } from '../core/rulings/rulings.ts';

export interface SavedReview {
  readonly input: Table;
  readonly rawSteps: readonly unknown[];
  readonly decisions: readonly Decision[];
  readonly outboundColumnIds: readonly ColumnId[];
  readonly excludedColumnIds: readonly ColumnId[];
}
export interface SavedSession {
  readonly version: 1;
  readonly filename: string;
  readonly original: Blob;
  readonly input: Table;
  readonly meta: ParseMeta;
  readonly acknowledged: boolean;
  readonly excluded: readonly ColumnId[];
  readonly events: readonly JournalEvent[];
  readonly rulings: readonly Ruling[];
  readonly review?: SavedReview;
  readonly source: string;
  readonly notes: readonly string[];
}
interface Head {
  readonly generation: string;
  readonly chunks: number;
  readonly session: Omit<SavedSession, 'events'>;
}
interface LocalDatabase extends DBSchema {
  heads: { key: string; value: Head };
  chunks: { key: string; value: string };
}
const CHUNK_CHARS = 64 * 1024;
const chunkKey = (generation: string, index: number): string => `${generation}:${index}`;
const database = () => openDB<LocalDatabase>('csv-cleaning-agent', 1, {
  upgrade(db) { db.createObjectStore('heads'); db.createObjectStore('chunks'); },
});
let writes: Promise<void> = Promise.resolve();
let observedGeneration: string | null = null;

/** Head, all journal chunks and removal of the previous generation are one atomic transaction. */
export function saveSession(session: SavedSession): Promise<void> {
  const write = writes.then(async () => {
    const db = await database();
    const text = JSON.stringify(session.events);
    const chunks = Math.ceil(text.length / CHUNK_CHARS);
    const generation = crypto.randomUUID();
    const { events: _events, ...metadata } = session;
    const tx = db.transaction(['heads', 'chunks'], 'readwrite');
    try {
      const previous = await tx.objectStore('heads').get('current');
      if ((previous?.generation ?? null) !== observedGeneration)
        throw new Error('Another tab updated this session. Reload before making more changes.');
      const requests: Promise<unknown>[] = [];
      for (let index = 0; index < chunks; index += 1) requests.push(tx.objectStore('chunks').put(
        text.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS), chunkKey(generation, index)));
      requests.push(tx.objectStore('heads').put({ generation, chunks, session: metadata }, 'current'));
      if (previous !== undefined) for (let index = 0; index < previous.chunks; index += 1)
        requests.push(tx.objectStore('chunks').delete(chunkKey(previous.generation, index)));
      await Promise.all(requests);
      await tx.done;
      observedGeneration = generation;
    } catch (error) {
      try { tx.abort(); } catch { /* A rejected request may already have aborted it. */ }
      await tx.done.catch(() => undefined);
      throw new Error(`Local save failed; previous saved state kept: ${error instanceof Error ? error.message : String(error)}`);
    } finally { db.close(); }
  });
  writes = write.catch(() => undefined);
  return write;
}

export async function loadSession(): Promise<SavedSession | null> {
  await writes;
  const db = await database();
  try {
    const tx = db.transaction(['heads', 'chunks'], 'readonly');
    const head = await tx.objectStore('heads').get('current');
    if (head === undefined) { await tx.done; observedGeneration = null; return null; }
    const requests: Promise<string | undefined>[] = [];
    for (let index = 0; index < head.chunks; index += 1)
      requests.push(tx.objectStore('chunks').get(chunkKey(head.generation, index)));
    const chunks = await Promise.all(requests);
    await tx.done;
    if (chunks.some((chunk) => chunk === undefined)) throw new Error('Saved journal is incomplete; import the original and exported journal for recovery.');
    if (head.session.version !== 1) throw new Error('Unsupported local session version.');
    observedGeneration = head.generation;
    return { ...head.session, events: JSON.parse(chunks.join('')) as JournalEvent[] };
  } finally { db.close(); }
}

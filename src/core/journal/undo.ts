import type { Table } from '../table.ts';
import { invertStep } from '../transformkit/registry.ts';
import { UndoEventSchema, sealEvent, type JournalEvent } from './events.ts';
import { eventDelta, fold, type FoldResult } from './fold.ts';
import { hashTable } from './hash.ts';

/** Keep the first keepCount currently active applies. Each inverse appends a separately checked event. */
export async function undoTo(input: Table, journal: readonly JournalEvent[], keepCount: number, createdAt: string): Promise<FoldResult> {
  const current = await fold(input, journal);
  if (!Number.isSafeInteger(keepCount) || keepCount < 0 || keepCount > current.active.length) throw new Error('undo target must be an active step count');
  let table = current.table;
  const events = [...current.events];
  for (let i = current.active.length - 1; i >= keepCount; i -= 1) {
    const target = current.active[i];
    const inputHash = await hashTable(table);
    table = invertStep(table, eventDelta(target));
    const outputHash = await hashTable(table);
    if (outputHash !== target.input_hash) throw new Error(`undo ${target.seq} output_hash: inverse did not restore predecessor`);
    events.push(UndoEventSchema.parse(await sealEvent({ v: 1, seq: events.length, kind: 'undo', run_id: target.run_id,
      undo_of: { seq: target.seq, event_hash: target.event_hash, step_id: target.step_id }, input_hash: inputHash,
      output_hash: outputHash, prev_event_hash: events.at(-1)!.event_hash, created_at: createdAt })));
  }
  if (keepCount === 0 && await hashTable(table) !== await hashTable(input)) throw new Error('full undo output_hash: input not restored');
  return fold(input, events);
}
export async function undoLast(input: Table, journal: readonly JournalEvent[], createdAt: string): Promise<FoldResult> {
  const current = await fold(input, journal);
  if (current.active.length === 0) throw new Error('nothing to undo');
  return undoTo(input, journal, current.active.length - 1, createdAt);
}
export const undoAll = (input: Table, journal: readonly JournalEvent[], createdAt: string): Promise<FoldResult> => undoTo(input, journal, 0, createdAt);

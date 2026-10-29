import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseBytes } from '../../src/core/csv/parse.ts';
import { encodeTable, exportOptionsFromMeta } from '../../src/core/csv/serialize.ts';
import { apply } from '../../src/core/journal/apply.ts';
import { createGenesis, EventSchema, sealEvent, serializeJournal, type JournalEvent } from '../../src/core/journal/events.ts';
import { fold } from '../../src/core/journal/fold.ts';
import { hashCanonicalJson, hashTable } from '../../src/core/journal/hash.ts';
import { invariant } from '../../src/core/journal/invariant.ts';
import { undoAll, undoLast, undoTo } from '../../src/core/journal/undo.ts';
import { verify } from '../../src/core/journal/verify.ts';
import { approvedPlan } from '../../src/core/review/state.ts';
import { createTable } from '../../src/core/table.ts';
import type { PlanStep } from '../../src/core/transformkit/registry.ts';
import { TIME, approveAll, dedup, metaFor, trim } from '../fixtures/m3.ts';

const input = createTable([{ id: 'c0', name: 'City Name' }], [[' NYC '], [' NYC '], ['New York'], []]);
const steps: PlanStep[] = [
  { id: 'rename', op: 'rename_headers', columns: ['c0'], params: {} }, trim,
  { id: 'map', op: 'map_categories', columns: ['c0'], params: { groups: [{ from: ['NYC'], to: 'New York' }] } }, dedup,
];
async function run() {
  const genesis = await createGenesis(input, metaFor(input), 'test', TIME);
  const state = await approveAll(input, steps);
  return apply(input, [genesis], approvedPlan(state), TIME);
}
async function replaceEvent(events: readonly JournalEvent[], index: number, patch: Record<string, unknown>): Promise<JournalEvent[]> {
  const copy = [...events]; copy[index] = await sealEvent({ ...events[index], ...patch }) as JournalEvent; return copy;
}

describe('journal replay and exact undo', () => {
  it('empty plan leaves widths, cells, headers and rid unchanged', async () => {
    const genesis = await createGenesis(input, metaFor(input), 'empty', TIME);
    const result = await apply(input, [genesis], { steps: [], approvals: [] }, TIME);
    expect(result.table).toEqual(input);
  });
  it('rename → category → drop → full undo restores input and every intermediate hash', async () => {
    const result = await run();
    for (let k = 0; k <= result.active.length; k += 1) {
      const undone = await undoTo(input, result.events, k, TIME);
      expect(await hashTable(undone.table)).toBe(k === 0 ? await hashTable(input) : result.active[k - 1].output_hash);
      expect((await invariant(input, undone.events, undone.table)).unexplained).toBe(0);
    }
    expect((await undoAll(input, result.events, TIME)).table).toEqual(input);
  });
  it('small random ragged tables preserve hash identity and deterministic replay', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }), { maxLength: 12 }), async (rows) => {
      const table = createTable([0, 1, 2].map((n) => ({ id: `c${n}`, name: `value_${n}` })), rows);
      const plan = approvedPlan(await approveAll(table, [trim, dedup]));
      const genesis = await createGenesis(table, metaFor(table), 'property', TIME);
      const a = await apply(table, [genesis], plan, TIME); const b = await apply(table, [genesis], plan, TIME);
      expect(await hashTable(a.table)).toBe(await hashTable(b.table));
      expect((await undoAll(table, a.events, TIME)).table).toEqual(table);
      expect((await invariant(table, a.events, a.table)).unexplained).toBe(0);
    }), { numRuns: 40 });
  });
  it('counts unexplained edits and resurrected dropped rows by rid', async () => {
    const result = await run();
    expect((await invariant(input, result.events, { ...result.table, rows: [['wrong'], ...result.table.rows.slice(1)] })).unexplained).toBeGreaterThan(0);
    expect((await invariant(input, result.events, input)).differences.some((d) => d.kind === 'row_presence')).toBe(true);
  });
  it('rejects schema extras and misaligned columnar changes', async () => {
    const result = await run();
    expect(EventSchema.safeParse({ ...result.events[1], injected: true }).success).toBe(false);
    const event = result.active.find((e) => e.changes.rid.length > 0)!;
    expect(EventSchema.safeParse({ ...event, changes: { ...event.changes, old: [] } }).success).toBe(false);
  });
});

describe('verify consistency and named failures', () => {
  async function fixture() {
    const bytes = new TextEncoder().encode('City Name\n NYC \n NYC \nNew York\n');
    const parsed = parseBytes(bytes); if (!parsed.ok) throw new Error(parsed.error.message);
    const genesis = await createGenesis(parsed.table, parsed.meta, 'verify', TIME);
    let result = await apply(parsed.table, [genesis], approvedPlan(await approveAll(parsed.table, steps)), TIME);
    result = await undoLast(parsed.table, result.events, TIME);
    const next = approvedPlan(await approveAll(result.table, [dedup]));
    result = await apply(parsed.table, result.events, next, TIME);
    return { bytes, parsed, result, output: encodeTable(result.table, exportOptionsFromMeta(parsed.meta)) };
  }
  it('accepts genesis + apply + undo + reapply and aligns output rid after drops', async () => {
    const { bytes, result, output } = await fixture();
    expect((await verify(serializeJournal(result.events), bytes, output)).ok).toBe(true);
  });
  it('rejects each recorded tamper class at an event and field', async () => {
    const { parsed, result } = await fixture();
    const event = result.active.find((e) => e.changes.rid.length > 0)!;
    const badParams = await replaceEvent(result.events, event.seq, { params: { ends: true, collapse_inner: true, nbsp: false, zero_width: false } });
    await expect(fold(parsed.table, badParams)).rejects.toThrow(/event \d+ params_hash/);
    const changedParams = { ends: true, collapse_inner: false, nbsp: true, zero_width: true };
    // Recomputed params/event digests do not make a changed delta consistent with execution.
    const opTamper = await replaceEvent(result.events, event.seq, { columns: ['c0'], params: { ...changedParams, ends: true, collapse_inner: true },
      params_hash: await hashCanonicalJson({ ...changedParams, ends: true, collapse_inner: true }) });
    const opEvent = opTamper[event.seq];
    if (opEvent.kind !== 'apply') throw new Error('expected apply');
    opTamper[event.seq] = await sealEvent({ ...opEvent,
      approval_ref: { ...opEvent.approval_ref, params_hash: opEvent.params_hash },
      changes: { ...opEvent.changes, new: opEvent.changes.new.map(() => 'different') } }) as JournalEvent;
    await expect(fold(parsed.table, opTamper)).rejects.toThrow(/event \d+ delta/);
    const badDelta = await replaceEvent(result.events, event.seq, { changes: { ...event.changes, new: event.changes.new.map(() => 'tampered') } });
    await expect(fold(parsed.table, badDelta)).rejects.toThrow(/event \d+ delta/);
    await expect(fold(parsed.table, result.events.filter((_, i) => i !== 1))).rejects.toThrow(/event 1 seq/);
    await expect(fold(parsed.table, [result.events[0], result.events[2], result.events[1]])).rejects.toThrow(/event 1 seq/);
    const undoIndex = result.events.findIndex((e) => e.kind === 'undo');
    const badUndo = await replaceEvent(result.events, undoIndex, { undo_of: { seq: 1, event_hash: result.events[1].event_hash, step_id: 'rename' } });
    await expect(fold(parsed.table, badUndo)).rejects.toThrow(/undo_of/);
    for (const target of result.active.filter((e) => e.header_change !== undefined || e.dropped !== undefined)) {
      const patch = target.header_change !== undefined ? { header_change: { ...target.header_change, new: ['bad_header'] } }
        : { dropped: { ...target.dropped!, rows: target.dropped!.rows.map(() => ['bad row']) } };
      await expect(fold(parsed.table, await replaceEvent(result.events, target.seq, patch))).rejects.toThrow(/delta/);
    }
  });
  it('rejects changed parse metadata, output.csv and event digests', async () => {
    const { bytes, parsed, result, output } = await fixture();
    const genesis = result.events[0]; if (genesis.kind !== 'genesis') throw new Error('expected genesis');
    const wrongMeta = await replaceEvent(result.events, 0, { parse: { ...genesis.parse, encoding: 'windows-1252' } });
    await expect(verify(serializeJournal(wrongMeta), bytes, output)).rejects.toThrow(/event 0 parse.encoding/);
    await expect(verify(serializeJournal(result.events), bytes, new TextEncoder().encode('City Name\nwrong\n'))).rejects.toThrow(/output.csv/);
    await expect(fold(parsed.table, [{ ...genesis, input_hash: '0'.repeat(64) }, ...result.events.slice(1)])).rejects.toThrow(/event 0 event_hash/);
  });
});

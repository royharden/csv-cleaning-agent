import { describe, expect, it } from 'vitest';
import { createTable, type Table } from '../../src/core/table.ts';
import { oracleDecision } from '../../scripts/eval/oracle.ts';
import { runPlan } from '../../scripts/eval/run.ts';
import type { SeededDataset } from '../../scripts/seededdirty/manifest.ts';
function dataset(dirty: Table, clean: Table): SeededDataset {
  return { id: 'orders-101', family: 'orders', split: 'heldout', seed: 101, dirty, clean,
    row_map: dirty.rid.map((rid) => ({ rid, clean_rid: rid, duplicate: false })), labels: { cells: [], headers: [], duplicates: [], traps: [] } };
}
const cols = [{ id: 'c0', name: 'value' }, { id: 'c1', name: 'note' }];
describe('cumulative literal oracle and labelled operational extension', () => {
  it('rejects a dedup-only step literally and keeps it under oracle+ops', () => {
    const dirty = createTable(cols, [['same', 'x'], ['same', 'x']]);
    const clean = createTable(cols, [['same', 'x']]);
    const data: SeededDataset = { ...dataset(dirty, clean),
      row_map: [{ rid: 0, clean_rid: 0, duplicate: false }, { rid: 1, clean_rid: 0, duplicate: true }],
      labels: { cells: [], headers: [], duplicates: [{ rid: 1, retained_rid: 0, trap: 'exact-duplicate' }], traps: [] } };
    expect(oracleDecision(data, dirty, clean, 'oracle').keep).toBe(false);
    expect(oracleDecision(data, dirty, clean, 'oracle+ops').keep).toBe(true);
  });
  it('keeps a cell fix plus good-row drop literally but the extension vetoes the drop', () => {
    const dirty = createTable(cols, [[' bad ', 'x'], ['good', 'safe']]);
    const clean = createTable(cols, [['bad', 'x'], ['good', 'safe']]);
    const data = dataset(dirty, clean); const candidate = createTable(cols, [['bad', 'x']], [0]);
    expect(oracleDecision(data, dirty, candidate, 'oracle').keep).toBe(true);
    expect(oracleDecision(data, dirty, candidate, 'oracle+ops')).toMatchObject({ keep: false, reason: 'drops a good row' });
  });
  it('does not silently add the extension mangle veto to the literal spec', () => {
    const dirty = createTable(cols, [['bad', 'also bad']]); const clean = createTable(cols, [['good', 'good']]);
    const data = dataset(dirty, clean); const candidate = createTable(cols, [['good', 'third']]);
    expect(oracleDecision(data, dirty, candidate, 'oracle').keep).toBe(true);
    expect(oracleDecision(data, dirty, candidate, 'oracle+ops')).toMatchObject({ keep: false, reason: 'mangles a cell' });
    const cleanCellData = dataset(createTable(cols, [['bad', 'safe']]), createTable(cols, [['good', 'safe']]));
    expect(oracleDecision(cleanCellData, cleanCellData.dirty, createTable(cols, [['good', 'damaged']]), 'oracle').keep).toBe(false);
  });
  it('recomputes a rejected trim → parse suffix on the actually kept predecessor', async () => {
    const dirty = createTable(cols, [[' $1,200.50 ', 'safe']]); const clean = createTable(cols, [['1200.50', 'safe']]);
    const data = dataset(dirty, clean);
    const steps = [
      { id: 'trim', op: 'trim_whitespace', columns: ['c0'], params: { ends: true, collapse_inner: false, nbsp: true, zero_width: true } },
      { id: 'parse', op: 'parse_number', columns: ['c0'], params: { decimal: '.', thousands: ',', currency: ['$'], parens_negative: true } },
    ];
    const literal = await runPlan(data, steps, 'oracle');
    expect(literal.decisions.map((step) => step.status)).toEqual(['oracle-rejected', 'oracle-rejected']);
    expect(literal.output).toEqual(dirty); expect(literal.deterministic).toMatchObject({ unexplained: 0, undo_input_hash_equal: true, repeat_hash_equal: true });
    const unreviewed = await runPlan(data, steps, 'unreviewed');
    expect(unreviewed.score.cells.fixed).toBe(1); expect(unreviewed.deterministic.undo_every_step).toBe(true);
  });
});

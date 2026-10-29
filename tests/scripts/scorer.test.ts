import { describe, expect, it } from 'vitest';
import { createTable } from '../../src/core/table.ts';
import { classify, scoreDataset } from '../../scripts/eval/scorer.ts';
import { replaceGeneratedLimitations, LIMITATIONS_MARKER } from '../../scripts/eval/limitations.ts';
import { matchedSubset, selectSubsetColumns } from '../../scripts/eval/subset.ts';
import type { SeededDataset } from '../../scripts/seededdirty/manifest.ts';
function handCase(): SeededDataset {
  const cols = [{ id: 'c0', name: 'Dirty Header' }, { id: 'c1', name: 'safe' }];
  return { id: 'orders-101', family: 'orders', split: 'heldout', seed: 101,
    dirty: createTable(cols, [['bad-a', 'good'], ['bad-b', 'keep'], ['bad-c', 'safe']]),
    clean: createTable([{ id: 'c0', name: 'dirty_header' }, cols[1]], [['a', 'good'], ['b', 'keep'], ['c', 'safe']]),
    row_map: [0, 1, 2].map((rid) => ({ rid, clean_rid: rid, duplicate: false })),
    labels: { cells: [0, 1, 2].map((rid) => ({ rid, column: 'c0', dirty: `bad-${'abc'[rid]}`, clean: 'abc'[rid],
      label: 'fixable_by', fixable_by: 'map_categories', trap: `error-${rid}`, variant: 'alias' })),
      headers: [{ column: 'c0', dirty: 'Dirty Header', clean: 'dirty_header', label: 'fixable_by', fixable_by: 'rename_headers', trap: 'headers' }],
      duplicates: [], traps: [{ name: 'error-1', rids: [1], columns: ['c0'], expectation: 'repair', detail: 'unrepaired' }] } };
}
describe('rid-aligned damage scorer', () => {
  it('separates fixed/unfixed/mangled/wrongly-changed despite output row order', () => {
    const data = handCase();
    const output = createTable(data.clean.cols, [['third-value', 'safe'], ['a', 'damaged'], ['bad-b', 'keep']], [2, 0, 1]);
    const score = scoreDataset(data, output, 7);
    expect(score.cells).toEqual({ fixed: 1, unfixed: 1, mangled: 1, wrongly_changed: 1, unchanged: 2 });
    expect(score.headers.fixed).toBe(1); expect(score.unparsed).toBe(7);
    expect(score.fixable_errors).toBe(3); expect(score.rates.fixed_fixable).toBe(1 / 3);
    expect(score.categories.alias).toMatchObject({ errors: 3, fixed: 1, mangled: 1 });
    expect(score.wrongly_changed[0]).toMatchObject({ rid: 0, column: 'c1' });
    expect(score.missed_traps).toContain('error-1');
  });
  it('does not award repairs for dropping errors; counts good rows separately', () => {
    const data = handCase(); const output = createTable(data.dirty.cols, [data.dirty.rows[2]], [2]);
    const score = scoreDataset(data, output);
    expect(score.cells.fixed).toBe(0); expect(score.cells.unfixed).toBe(3);
    expect(score.dropped_dirty_cells).toBe(2); expect(score.good_rows_dropped).toEqual([0, 1]);
    expect(score.cells.wrongly_changed).toBe(0);
  });
  it('credits true duplicate removal only while its retained row survives', () => {
    const base = handCase();
    const data: SeededDataset = { ...base, dirty: createTable(base.dirty.cols, [...base.dirty.rows, base.dirty.rows[0]], [0, 1, 2, 9]),
      row_map: [...base.row_map, { rid: 9, clean_rid: 0, duplicate: true }],
      labels: { ...base.labels, duplicates: [{ rid: 9, retained_rid: 0, trap: 'exact-duplicate' }] } };
    expect(scoreDataset(data, base.dirty).duplicates).toEqual({ total: 1, removed: 1, recall: 1 });
    const missingBoth = createTable(base.dirty.cols, [base.dirty.rows[1], base.dirty.rows[2]], [1, 2]);
    expect(scoreDataset(data, missingBoth).duplicates.removed).toBe(0);
    expect(scoreDataset(data, missingBoth).good_rows_dropped).toEqual([0]);
  });
  it('resolves a trimmed-and-dropped padded duplicate trap without crediting its dropped error cells', () => {
    const cols = [{ id: 'c0', name: 'value' }];
    const data: SeededDataset = { id: 'orders-101', family: 'orders', split: 'heldout', seed: 101,
      dirty: createTable(cols, [['keep'], ['  keep  ']], [0, 9]), clean: createTable(cols, [['keep']], [0]),
      row_map: [{ rid: 0, clean_rid: 0, duplicate: false }, { rid: 9, clean_rid: 0, duplicate: true }],
      labels: { cells: [{ rid: 9, column: 'c0', dirty: '  keep  ', clean: 'keep', label: 'fixable_by',
        fixable_by: 'trim_whitespace', trap: 'padded-duplicate' }], headers: [],
        duplicates: [{ rid: 9, retained_rid: 0, trap: 'padded-duplicate' }],
        traps: [{ name: 'padded-duplicate', rids: [0, 9], columns: ['c0'], expectation: 'repair', detail: 'Trim then keep first rid.' }] } };
    const score = scoreDataset(data, data.clean);
    expect(score.missed_traps).not.toContain('padded-duplicate');
    expect(score.duplicates).toEqual({ total: 1, removed: 1, recall: 1 });
    expect(score.outcomes.find((outcome) => outcome.rid === 9)).toMatchObject({ kind: 'unfixed', dropped: true });
    expect(score.cells.fixed).toBe(0); expect(score.cells.unfixed).toBe(1);
    expect(score.dropped_dirty_cells).toBe(1); expect(score.fixable_fixed).toBe(0); expect(score.rates.fixed_fixable).toBe(0);
  });
  it('misses an exact duplicate trap when both the duplicate and its retained row are dropped', () => {
    const cols = [{ id: 'c0', name: 'value' }];
    const data: SeededDataset = { id: 'orders-101', family: 'orders', split: 'heldout', seed: 101,
      dirty: createTable(cols, [['keep'], ['keep']], [0, 9]), clean: createTable(cols, [['keep']], [0]),
      row_map: [{ rid: 0, clean_rid: 0, duplicate: false }, { rid: 9, clean_rid: 0, duplicate: true }],
      labels: { cells: [], headers: [], duplicates: [{ rid: 9, retained_rid: 0, trap: 'exact-duplicate' }],
        traps: [{ name: 'exact-duplicate', rids: [0, 9], columns: ['c0'], expectation: 'repair', detail: 'Keep first rid.' }] } };
    expect(scoreDataset(data, data.clean).missed_traps).not.toContain('exact-duplicate');
    const score = scoreDataset(data, createTable(cols, []));
    expect(score.missed_traps).toContain('exact-duplicate');
    expect(score.duplicates).toEqual({ total: 1, removed: 0, recall: 0 });
    expect(score.good_rows_dropped).toEqual([0]);
  });
  it('distinguishes empty from missing and uses N/A for empty denominators', () => {
    expect(classify('', '', undefined)).toBe('wrongly_changed');
    expect(classify(undefined, undefined, '')).toBe('wrongly_changed');
    const data = handCase();
    const cleanOnly = { ...data, dirty: data.clean, labels: { ...data.labels, cells: [] } };
    expect(scoreDataset(cleanOnly, data.clean).rates.fixed_all).toBeNull();
  });
});
describe('matched population and generated evidence boundary', () => {
  it('chooses columns from dev labels and projects original row identities without relabelling IDs', () => {
    const base = handCase(); const cols = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: `v${i}` }));
    const table = createTable(cols, Array.from({ length: 220 }, () => cols.map(() => 'x')));
    const dev: SeededDataset = { ...base, id: 'orders-1', seed: 1, split: 'dev', dirty: table, clean: table,
      row_map: table.rid.map((rid) => ({ rid, clean_rid: rid, duplicate: false })),
      labels: { cells: [{ rid: 0, column: 'c6', dirty: 'x', clean: 'y', label: 'fixable_by', fixable_by: 'trim_whitespace', trap: 'dev-error' }], headers: [], duplicates: [], traps: [] } };
    const selection = selectSubsetColumns([dev], 'orders');
    expect(selection.columns[0]).toBe('c6'); expect(selection.dev_ids).toEqual(['orders-1']);
    const subset = matchedSubset({ ...dev, id: 'orders-101', split: 'heldout', seed: 101 }, selection);
    expect(subset.dirty.rows).toHaveLength(200); expect(subset.dirty.cols).toHaveLength(6);
    expect(subset.dirty.cols.map((column) => column.id)).toContain('c6'); expect(subset.dirty.rid[199]).toBe(199);
    expect(() => selectSubsetColumns([{ ...dev, split: 'heldout' }], 'orders')).toThrow('No dev labels');
  });
  it('preserves static limitations byte-for-byte and refuses missing/duplicate markers', () => {
    const prefix = `# Known design limitations\r\nKeep this exact.\r\n${LIMITATIONS_MARKER}`;
    expect(replaceGeneratedLimitations(prefix + '\nold result', 'new result')).toBe(prefix + '\n\nnew result');
    expect(() => replaceGeneratedLimitations('no marker', 'new')).toThrow('exactly one');
    expect(() => replaceGeneratedLimitations(LIMITATIONS_MARKER.repeat(2), 'new')).toThrow('exactly one');
  });
});

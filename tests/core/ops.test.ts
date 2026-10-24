/**
 * The eight ops, the shared delta engine, preview chain, review samples and exact edit distance
 * (PLAN.md M2 AC1, AC4, AC8; C §5.1 "Ops", "Case"). Written in Dirty Mode; not executed yet.
 */

import { describe, expect, it } from 'vitest';
import { hashTable } from '../../src/core/journal/hash.ts';
import { columnOrdinal, largestEdits, levenshtein } from '../../src/core/review/editdistance.ts';
import { changedRowSamples } from '../../src/core/review/samples.ts';
import { tablesEqual, type Table } from '../../src/core/table.ts';
import { DeltaMismatchError, OpError, applyDelta, invertDelta } from '../../src/core/transformkit/delta.ts';
import { caseValue, titleCase } from '../../src/core/transformkit/ops/normalize_case.ts';
import { snakeCase } from '../../src/core/transformkit/ops/rename_headers.ts';
import { trimValue } from '../../src/core/transformkit/ops/trim_whitespace.ts';
import { previewChain, previewStep } from '../../src/core/transformkit/preview.ts';
import { OPS, applyStep, invertStep, type PlanStep, type StepDelta } from '../../src/core/transformkit/registry.ts';
import { columnTable, makeTable } from '../fixtures/tables.ts';

const TRIM = { ends: true as const, collapse_inner: false, nbsp: true, zero_width: true };
const NUM = { decimal: '.', thousands: ',', currency: ['$'], parens_negative: true };

function step(op: PlanStep['op'], params: unknown, columns: string[], id: string = op): PlanStep {
  return { id, op, columns, params };
}

/** A ragged, messy table that every op can run on. */
const messy: Table = makeTable(
  ['Order ID', 'Customer Name', 'city', 'amount', 'order_date', 'country'],
  [
    ['001', ' ada  lovelace ', 'NYC', '$1,204.50', '03/04/2023', 'US'],
    ['002', 'GRACE\u00a0HOPPER', 'New York', '(12.00)', '25/12/2023', 'NA'],
    ['003', 'alan\u200bturing', 'new york', '12%', '31/02/2023', 'DE'],
    ['001', ' ada  lovelace ', 'NYC', '$1,204.50', '03/04/2023', 'US'],
    ['004', 'short'],
    ['001', ' ada  lovelace ', 'NYC', '$1,204.50', '03/04/2023', 'US'],
  ],
);

const ALL_STEPS: readonly PlanStep[] = [
  step('rename_headers', {}, ['c0', 'c1']),
  step('trim_whitespace', { ...TRIM, collapse_inner: true }, ['c1', 'c2']),
  step('null_tokens', { tokens: ['NA'] }, ['c5']),
  step('normalize_case', { mode: 'title' }, ['c1']),
  step('parse_number', NUM, ['c3']),
  step('standardize_date', { from_format: 'DD/MM/YYYY' }, ['c4']),
  step('map_categories', { groups: [{ from: ['NYC', 'new york'], to: 'New York' }] }, ['c2']),
  step('drop_duplicate_rows', {}, []),
];

describe('every op: apply is pure, preview == apply, invert is exact', () => {
  for (const s of ALL_STEPS) {
    it(`${s.op}: apply then invert restores the input (cells, widths, rids, names, hash)`, async () => {
      const before = await hashTable(messy);
      const result = applyStep(messy, s);
      const restored = invertStep(result.table, result.delta);
      expect(tablesEqual(restored, messy)).toBe(true);
      expect(await hashTable(restored)).toBe(before);
    });

    it(`${s.op}: does not mutate its input`, async () => {
      const before = await hashTable(messy);
      applyStep(messy, s);
      expect(await hashTable(messy)).toBe(before);
    });

    it(`${s.op}: preview counts equal the apply diff`, () => {
      const result = applyStep(messy, s);
      const preview = previewStep(messy, s);
      expect(preview.counts).toEqual(result.counts);
      expect(preview.counts.changed).toBe(result.delta.changes.rid.length);
      expect(preview.counts.dropped).toBe(result.delta.dropped?.rid.length ?? 0);
      expect(preview.counts.headers).toBe(result.delta.header_change?.id.length ?? 0);
      expect(tablesEqual(preview.result.table, result.table)).toBe(true);
    });

    it(`${s.op}: applyDelta replays the recorded delta to the same table`, () => {
      const result = applyStep(messy, s);
      expect(tablesEqual(applyDelta(messy, result.delta), result.table)).toBe(true);
    });

    it(`${s.op}: never writes a missing position of a ragged row`, () => {
      const result = applyStep(messy, s);
      const short = result.table.rows[result.table.rid.indexOf(4)];
      expect(short).toHaveLength(2);
    });

    it(`${s.op}: exports {schema, apply, preview, invert, check} with a strict schema`, () => {
      const def = OPS[s.op];
      expect(def.name).toBe(s.op);
      expect(def.schema.safeParse({ ...(s.params as object), unexpected: 1 }).success).toBe(false);
    });
  }
});

describe('rename -> category -> drop -> undo restores identity and hash', () => {
  it('reverses a three-step sequence exactly, step by step', async () => {
    const steps = [ALL_STEPS[0], ALL_STEPS[6], ALL_STEPS[7]];
    const states: Table[] = [messy];
    const deltas: StepDelta[] = [];
    for (const s of steps) {
      const result = applyStep(states[states.length - 1], s);
      states.push(result.table);
      deltas.push(result.delta);
    }
    const hashes = await Promise.all(states.map((t) => hashTable(t)));
    let current = states[states.length - 1];
    for (let k = steps.length - 1; k >= 0; k -= 1) {
      current = invertStep(current, deltas[k]);
      expect(await hashTable(current)).toBe(hashes[k]);
    }
    expect(tablesEqual(current, messy)).toBe(true);
  });

  it('invert refuses a delta that does not match the table', () => {
    const result = applyStep(messy, ALL_STEPS[6]);
    expect(() => invertDelta(messy, result.delta)).toThrow(DeltaMismatchError);
  });
});

describe('rename_headers', () => {
  it('snake_cases with Latin-1 folding, collapsing and the c_ prefix', () => {
    expect(snakeCase('Order ID')).toBe('order_id');
    expect(snakeCase('  Customer   Name ')).toBe('customer_name');
    expect(snakeCase('Café Größe')).toBe('cafe_grosse');
    expect(snakeCase('2023 Revenue ($)')).toBe('c_2023_revenue');
    expect(snakeCase('already_snake')).toBe('already_snake');
    expect(snakeCase('***')).toBe('');
  });

  it('changes names only (ids stay), recording only changed names', () => {
    const result = applyStep(messy, step('rename_headers', {}, ['c0', 'c2']));
    expect(result.table.cols.map((c) => c.id)).toEqual(messy.cols.map((c) => c.id));
    expect(result.delta.header_change).toEqual({ id: ['c0'], old: ['Order ID'], new: ['order_id'] });
    expect(result.counts.headers).toBe(1);
  });

  it('apply refuses a colliding rename instead of guessing', () => {
    const table = makeTable(['Order ID', 'order_id'], [['1', '2']]);
    expect(() => applyStep(table, step('rename_headers', {}, ['c0']))).toThrow(OpError);
  });
});

describe('trim_whitespace', () => {
  it('handles NBSP, zero-width and interior runs as configured', () => {
    expect(trimValue('  a  b  ', TRIM)).toBe('a  b');
    expect(trimValue('  a  b  ', { ...TRIM, collapse_inner: true })).toBe('a b');
    expect(trimValue('\u00a0x\u00a0', TRIM)).toBe('x');
    expect(trimValue('\u00a0x\u00a0', { ...TRIM, nbsp: false })).toBe('\u00a0x\u00a0');
    expect(trimValue('\u200bx\ufeff', TRIM)).toBe('x');
    expect(trimValue('\u200bx\ufeff', { ...TRIM, zero_width: false })).toBe('\u200bx\ufeff');
    expect(trimValue('a\nb', { ...TRIM, collapse_inner: true })).toBe('a\nb');
    expect(trimValue('\tx\r\n', TRIM)).toBe('x');
  });
});

describe('normalize_case (fixed en-US locale; length-preserving)', () => {
  it('José -> JOSÉ under upper', () => {
    expect(caseValue('José', 'upper')).toBe('JOSÉ');
  });

  it('a ß cell is left unchanged and counted as unparsed', () => {
    expect(caseValue('Straße', 'upper')).toBeNull();
    const result = applyStep(columnTable('n', ['Straße', 'abc']), step('normalize_case', { mode: 'upper' }, ['c0']));
    expect(result.counts.unparsed).toBe(1);
    expect(result.counts.changed).toBe(1);
    expect(result.table.rows[0][0]).toBe('Straße');
    expect(result.unparsed_samples).toEqual([{ rid: 0, col: 'c0', value: 'Straße' }]);
  });

  it('does not vary with a Turkish default locale (i stays I, not dotted I)', () => {
    expect(caseValue('istanbul', 'upper')).toBe('ISTANBUL');
    expect(caseValue('istanbul', 'upper')).not.toBe('istanbul'.toLocaleUpperCase('tr-TR'));
    expect(caseValue('ISTANBUL', 'lower')).toBe('istanbul');
  });

  it('title-cases each whitespace-separated word and keeps the separators', () => {
    expect(titleCase('ada  lovelace')).toBe('Ada  Lovelace');
    expect(titleCase('GRACE HOPPER')).toBe('Grace Hopper');
    expect(caseValue('émile zola', 'title')).toBe('Émile Zola');
  });
});

describe('null_tokens', () => {
  it('replaces exact, case-sensitive matches only, without trimming', () => {
    const result = applyStep(columnTable('x', ['NA', 'na', ' NA', 'N/A', 'ok']), step('null_tokens', { tokens: ['NA', 'N/A'] }, ['c0']));
    expect(result.table.rows.map((r) => r[0])).toEqual(['', 'na', ' NA', '', 'ok']);
    expect(result.counts.changed).toBe(2);
  });
});

describe('parse_number and standardize_date on a column', () => {
  it('parse_number: valid cells canonical, others unchanged and counted; empty cells skipped', () => {
    const result = applyStep(columnTable('a', ['$1,204.50', ' 12', '12%', '', '(3)']), step('parse_number', NUM, ['c0']));
    expect(result.table.rows.map((r) => r[0])).toEqual(['1204.50', ' 12', '12%', '', '-3']);
    expect(result.counts).toMatchObject({ changed: 2, unparsed: 2, examined: 5 });
  });

  it('standardize_date: stated format only; impossible dates unparsed', () => {
    const result = applyStep(
      columnTable('d', ['25/12/2023', '31/02/2023', '2023-12-25', '']),
      step('standardize_date', { from_format: 'DD/MM/YYYY' }, ['c0']),
    );
    expect(result.table.rows.map((r) => r[0])).toEqual(['2023-12-25', '31/02/2023', '2023-12-25', '']);
    expect(result.counts).toMatchObject({ changed: 1, unparsed: 2 });
  });
});

describe('map_categories', () => {
  it('records the full mapping and every changed cell; lookup is simultaneous (no chaining)', () => {
    const table = columnTable('c', ['a', 'b', 'c']);
    const s = step('map_categories', { groups: [{ from: ['a'], to: 'b' }, { from: ['b'], to: 'c' }] }, ['c0']);
    const result = applyStep(table, s);
    expect(result.table.rows.map((r) => r[0])).toEqual(['b', 'c', 'c']);
    expect(result.delta.mapping).toEqual({ column: 'c0', pairs: [['a', 'b'], ['b', 'c']] });
    expect(result.delta.changes).toEqual({ rid: [0, 1], col: ['c0', 'c0'], old: ['a', 'b'], new: ['b', 'c'] });
  });
});

describe('drop_duplicate_rows', () => {
  it('drops exact whole-record duplicates (values and widths), keeps the first, records positions', () => {
    const table = makeTable(['a', 'b'], [['x', '1'], ['x'], ['x', '1'], ['x', '1 '], ['x']]);
    const result = applyStep(table, step('drop_duplicate_rows', {}, []));
    expect(result.table.rid).toEqual([0, 1, 3]);
    expect(result.delta.dropped).toEqual({ rid: [2, 4], rows: [['x', '1'], ['x']], positions: [2, 4] });
    expect(tablesEqual(invertStep(result.table, result.delta), table)).toBe(true);
  });
});

describe('preview chain (approved-only basis, PLAN.md row 8)', () => {
  const table = columnTable('amount', [' 12', '7']);
  const trim = step('trim_whitespace', TRIM, ['c0'], 'trim');
  const parse = step('parse_number', NUM, ['c0'], 'parse');

  it('a later step previews on the table after the in-effect (approved) earlier steps only', () => {
    const approved = previewChain(table, [trim, parse], [true, false]);
    expect(approved.entries[1].preview?.counts).toMatchObject({ changed: 0, unparsed: 0 });
    const rejected = previewChain(table, [trim, parse], [false, false]);
    expect(rejected.entries[1].preview?.counts).toMatchObject({ unparsed: 1 });
    expect(tablesEqual(rejected.entries[1].predecessor, table)).toBe(true);
  });

  it('the final state contains only in-effect steps', () => {
    const chain = previewChain(table, [trim, parse], [true, true]);
    expect(chain.final.rows.map((r) => r[0])).toEqual(['12', '7']);
    expect(previewChain(table, [trim, parse], [false, false]).final).toBe(table);
  });

  it('carries guard hits computed on each predecessor', () => {
    const ids = columnTable('id', ['007', '8']);
    const chain = previewChain(ids, [step('parse_number', NUM, ['c0'], 'p')], [false]);
    expect(chain.entries[0].guards.map((g) => g.guard)).toEqual(['leading_zero_id']);
  });
});

describe('review samples and exact edit distance', () => {
  it('levenshtein is exact over code points', () => {
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('flaw', 'lawn')).toBe(2);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('\u{1f600}a', 'a')).toBe(1);
    expect(levenshtein('José', 'JOSÉ')).toBe(3);
  });

  it('ranks an equal-length rewrite above a small edit; ties by (rid, column)', () => {
    const changes = {
      rid: [0, 1, 2, 3],
      col: ['c1', 'c0', 'c0', 'c0'],
      old: [' x', 'abcd', 'ab', 'pq'],
      new: ['x', 'wxyz', 'cd', 'rs'],
    };
    const top = largestEdits(changes, 3);
    expect(top.map((e) => [e.rid, e.distance])).toEqual([
      [1, 4],
      [2, 2],
      [3, 2],
    ]);
    expect(columnOrdinal('c12')).toBe(12);
  });

  it('samples are the first five changed rows in table order with all their changed cells', () => {
    const table = makeTable(['a', 'b'], Array.from({ length: 8 }, (_, i) => [` ${i}`, ` ${i}`]));
    const result = applyStep(table, step('trim_whitespace', TRIM, ['c0', 'c1']));
    const samples = changedRowSamples(result.delta);
    expect(samples.map((s) => s.rid)).toEqual([0, 1, 2, 3, 4]);
    expect(samples[0].cells).toEqual([
      { col: 'c0', old: ' 0', new: '0' },
      { col: 'c1', old: ' 0', new: '0' },
    ]);
    expect(previewStep(table, step('trim_whitespace', TRIM, ['c0', 'c1'])).samples).toEqual(samples);
  });
});

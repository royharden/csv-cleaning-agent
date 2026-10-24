/**
 * Guards: one test per C §2.7 row, plus "a hit leaves the step valid but unconfirmed" (PLAN.md M2 AC5, AC10;
 * §8 item 6 for date_order). Written in Dirty Mode; not executed yet.
 */

import { describe, expect, it } from 'vitest';
import { DATE_FORMATS } from '../../src/core/constants.ts';
import { evaluateGuards, hasMixedCaseWord, type PlanContext } from '../../src/core/transformkit/guards.ts';
import type { PlanStep } from '../../src/core/transformkit/registry.ts';
import { validatePlan } from '../../src/core/transformkit/validator.ts';
import { allIds, columnTable, makeTable } from '../fixtures/tables.ts';

const NUM = { decimal: '.', thousands: ',', currency: [], parens_negative: false };
const TRIM = { ends: true, collapse_inner: false, nbsp: true, zero_width: true };

function step(op: PlanStep['op'], params: unknown, columns: string[] = ['c0'], id = 's'): PlanStep {
  return { id, op, columns, params };
}

function solo(s: PlanStep): PlanContext {
  return { steps: [s], index: 0 };
}

function guardIds(table: Parameters<typeof evaluateGuards>[0], s: PlanStep, ctx: PlanContext = solo(s)): string[] {
  return evaluateGuards(table, s, ctx).map((h) => h.guard);
}

describe('leading_zero_id (parse_number)', () => {
  it('hits on an ID-like column with leading zeros', () => {
    expect(guardIds(columnTable('id', ['007', '012', '345']), step('parse_number', NUM))).toEqual(['leading_zero_id']);
  });

  it('does not hit on "0.5" or "0" or on cells that are not valid numbers', () => {
    expect(guardIds(columnTable('x', ['0.5', '0', '12', 'A07']), step('parse_number', NUM))).toEqual([]);
  });

  it('sees the number part after a sign or currency marker', () => {
    const s = step('parse_number', { ...NUM, currency: ['$'] });
    expect(guardIds(columnTable('x', ['-012', '$05']), s)).toEqual(['leading_zero_id']);
  });
});

describe('thousands_ambiguity (parse_number)', () => {
  it('hits when "1,234"-like cells exist and nothing proves the convention', () => {
    expect(guardIds(columnTable('x', ['1,234', '12', '5,000']), step('parse_number', NUM))).toEqual(['thousands_ambiguity']);
  });

  it('a valid cell with both separators proves it', () => {
    expect(guardIds(columnTable('x', ['1,234', '2,345.50']), step('parse_number', NUM))).toEqual([]);
  });

  it('a valid fraction whose length is not 3 proves it', () => {
    expect(guardIds(columnTable('x', ['1,234', '12.5']), step('parse_number', NUM))).toEqual([]);
  });

  it('malformed cells never count as proof', () => {
    // "1,23.45" has both separators but malformed grouping; "1.2.3" is not valid either.
    expect(guardIds(columnTable('x', ['1,234', '1,23.45', '1.2.3']), step('parse_number', NUM))).toEqual(['thousands_ambiguity']);
  });

  it('applies to decimal-comma grammars too ("1.234" with decimal ",")', () => {
    const s = step('parse_number', { decimal: ',', thousands: '.', currency: [], parens_negative: false });
    expect(guardIds(columnTable('x', ['1.234', '7']), s)).toEqual(['thousands_ambiguity']);
    expect(guardIds(columnTable('x', ['1.234', '7,5']), s)).toEqual([]);
  });
});

describe('date_order (standardize_date, DD/MM and MM/DD families only)', () => {
  const ambiguous = columnTable('d', ['03/04/2023', '05/06/2023', '11/12/2023']);

  it('hits on an ambiguous column (no part above 12)', () => {
    const hits = evaluateGuards(ambiguous, step('standardize_date', { from_format: 'MM/DD/YYYY' }), solo(step('standardize_date', {})));
    expect(hits.map((h) => h.guard)).toEqual(['date_order']);
    expect(hits[0].message).toContain('Cannot prove day/month order');
    expect(hits[0].details.ambiguous).toBe(3);
  });

  it('does not hit when the stated order is proven and nothing contradicts it', () => {
    expect(guardIds(columnTable('d', ['25/04/2023', '03/04/2023']), step('standardize_date', { from_format: 'DD/MM/YYYY' }))).toEqual([]);
  });

  it('hits on a contradictory column and reports the counts of each proof', () => {
    const hits = evaluateGuards(
      columnTable('d', ['25/04/2023', '04/25/2023', '03/04/2023']),
      step('standardize_date', { from_format: 'DD/MM/YYYY' }),
      solo(step('standardize_date', {})),
    );
    expect(hits.map((h) => h.guard)).toEqual(['date_order']);
    expect(hits[0].details.proves_stated).toBe(1);
    expect(hits[0].details.proves_other).toBe(1);
    expect(hits[0].message).toContain('Contradictory');
  });

  it('hits when the cells prove the opposite order only', () => {
    expect(guardIds(columnTable('d', ['04/25/2023']), step('standardize_date', { from_format: 'DD/MM/YYYY' }))).toEqual(['date_order']);
  });

  it('never hits for YYYY-first formats, including YYYYMMDD', () => {
    for (const format of DATE_FORMATS.filter((f) => f.startsWith('YYYY'))) {
      expect(guardIds(columnTable('d', ['2023-04-03', '20230403']), step('standardize_date', { from_format: format }))).toEqual([]);
    }
  });

  it('does not borrow a proven order from a different column', () => {
    // Regression: c0 proves DD/MM but c1 remains ambiguous; both use the same step.
    const table = makeTable(['proven', 'ambiguous'], [['25/04/2023', '03/04/2023']]);
    const s = step('standardize_date', { from_format: 'DD/MM/YYYY' }, ['c0', 'c1']);
    const hits = evaluateGuards(table, s, solo(s));
    expect(hits.map((h) => h.guard)).toEqual(['date_order']);
    expect(hits[0].columns).toEqual(['c1']);
  });
});

describe('two_digit_year (standardize_date)', () => {
  it('hits on MM/DD/YY and DD/MM/YY', () => {
    expect(guardIds(columnTable('d', ['12/25/23']), step('standardize_date', { from_format: 'MM/DD/YY' }))).toEqual(['two_digit_year']);
    expect(guardIds(columnTable('d', ['25/12/23']), step('standardize_date', { from_format: 'DD/MM/YY' }))).toEqual(['two_digit_year']);
  });

  it('does not hit on YYYY-MM-DD', () => {
    expect(guardIds(columnTable('d', ['2023-12-25']), step('standardize_date', { from_format: 'YYYY-MM-DD' }))).toEqual([]);
  });

  it('can hit together with date_order, in GUARD_IDS order', () => {
    expect(guardIds(columnTable('d', ['03/04/23']), step('standardize_date', { from_format: 'MM/DD/YY' }))).toEqual([
      'date_order',
      'two_digit_year',
    ]);
  });
});

describe('null_shape_majority (null_tokens)', () => {
  it('hits on "NA" in a column of two-letter country codes', () => {
    const hits = evaluateGuards(
      columnTable('country', ['US', 'NA', 'DE', 'FR', 'NA']),
      step('null_tokens', { tokens: ['NA'] }),
      solo(step('null_tokens', {})),
    );
    expect(hits.map((h) => h.guard)).toEqual(['null_shape_majority']);
    expect(hits[0].message).toContain('Namibia');
  });

  it('does not hit on "NA" in a numeric column', () => {
    expect(guardIds(columnTable('amount', ['12', 'NA', '7', '1.5']), step('null_tokens', { tokens: ['NA'] }))).toEqual([]);
  });

  it('includes selected tokens in the normative non-empty denominator', () => {
    // Regression: removing the two NA cells before measuring would silently miss this majority.
    expect(guardIds(columnTable('code', ['NA', 'NA', '123']), step('null_tokens', { tokens: ['NA'] }))).toEqual(['null_shape_majority']);
    expect(guardIds(columnTable('code', ['NA', '12']), step('null_tokens', { tokens: ['NA'] }))).toEqual(['null_shape_majority']);
  });
});

describe('title_on_mixed (normalize_case title)', () => {
  it('hits on McDonald / iPhone / van Gogh', () => {
    expect(hasMixedCaseWord('Ronald McDonald')).toBe(true);
    expect(hasMixedCaseWord('iPhone')).toBe(true);
    expect(hasMixedCaseWord('Vincent van Gogh')).toBe(true);
    expect(hasMixedCaseWord('ada lovelace')).toBe(false);
    expect(guardIds(columnTable('n', ['Ronald McDonald', 'ada']), step('normalize_case', { mode: 'title' }))).toEqual(['title_on_mixed']);
  });

  it('does not hit for upper/lower modes or plain names', () => {
    expect(guardIds(columnTable('n', ['Ronald McDonald']), step('normalize_case', { mode: 'upper' }))).toEqual([]);
    expect(guardIds(columnTable('n', ['ada lovelace']), step('normalize_case', { mode: 'title' }))).toEqual([]);
  });
});

describe('category_target (map_categories)', () => {
  it('hits when one target absorbs more than 8 distinct sources', () => {
    const values = ['T', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'];
    const s = step('map_categories', { groups: [{ from: values.slice(1), to: 'T' }] });
    expect(guardIds(columnTable('c', values), s)).toEqual(['category_target']);
  });

  it('does not hit at exactly 8 sources with an observed target', () => {
    const values = ['T', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];
    expect(guardIds(columnTable('c', values), step('map_categories', { groups: [{ from: values.slice(1), to: 'T' }] }))).toEqual([]);
  });

  it('hits on a human-introduced unobserved target', () => {
    const s = step('map_categories', { groups: [{ from: ['NYC'], to: 'New York City' }] });
    const hits = evaluateGuards(columnTable('c', ['NYC', 'New York']), s, { ...solo(s), humanEdited: true });
    expect(hits.map((h) => h.guard)).toEqual(['category_target']);
    expect(hits[0].message).toContain('human-introduced');
  });

  it('counts distinct sources across all groups sharing the same target', () => {
    // Regression: splitting 9 sources into two groups must not evade the >8-source guard.
    const values = ['T', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'];
    const s = step('map_categories', { groups: [
      { from: values.slice(1, 6), to: 'T' },
      { from: values.slice(6), to: 'T' },
    ] });
    const hits = evaluateGuards(columnTable('c', values), s, solo(s));
    expect(hits.map((h) => h.guard)).toEqual(['category_target']);
    expect(hits[0].details.wide_targets).toBe(1);
  });
});

describe('dedup_before_trim (drop_duplicate_rows)', () => {
  const padded = makeTable(['a', 'b'], [['x', '1'], ['x ', '1'], ['y', '2']]);
  const dedup = step('drop_duplicate_rows', {}, []);
  const trim = step('trim_whitespace', TRIM, ['c0', 'c1'], 't');

  it('hits when a trim step comes later in the plan', () => {
    const exact = makeTable(['a'], [['x'], ['x']]);
    expect(guardIds(exact, dedup, { steps: [dedup, trim], index: 0 })).toEqual(['dedup_before_trim']);
  });

  it('hits when padding hides duplicates and no earlier trim is in effect', () => {
    expect(guardIds(padded, dedup, solo(dedup))).toEqual(['dedup_before_trim']);
    expect(guardIds(padded, dedup, { steps: [trim, dedup], index: 1, applied: [false, false] })).toEqual(['dedup_before_trim']);
  });

  it('does not hit after an earlier trim in effect, or when there is nothing to hide', () => {
    expect(guardIds(padded, dedup, { steps: [trim, dedup], index: 1, applied: [true, false] })).toEqual([]);
    expect(guardIds(makeTable(['a'], [['x'], ['y']]), dedup, solo(dedup))).toEqual([]);
  });
});

describe('a guard hit is never a validator rejection', () => {
  it('accepts the step (valid) while the guard makes it unconfirmed', () => {
    const table = columnTable('country', ['US', 'NA', 'DE', 'FR']);
    const raw = { id: 'nulls', op: 'null_tokens', columns: ['c0'], params: { tokens: ['NA'] } };
    const result = validatePlan({ version: 1, steps: [raw] }, { table, outboundColumnIds: allIds(table), excludedColumnIds: [] });
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
    const accepted = result.accepted[0].step;
    expect(evaluateGuards(table, accepted, { steps: [accepted], index: 0 }).map((h) => h.guard)).toEqual(['null_shape_majority']);
  });

  it('ops without guards return no hits', () => {
    expect(guardIds(columnTable('a', [' x ']), step('trim_whitespace', TRIM))).toEqual([]);
    expect(guardIds(columnTable('Order ID', ['1']), step('rename_headers', {}))).toEqual([]);
  });
});

/**
 * Local profile (spec item 2; C §1 item 2; PLAN.md M2 AC7). Pure. Computed on the FULL table, in the browser; it
 * is never sent anywhere (outbound.ts derives the separate, screened, size-bounded outbound profile).
 *
 * Per column (present cells only; missing positions of ragged rows are counted as `missing`):
 *   present / missing / empty / non_empty / distinct (non-empty) counts; top PROFILE_TOP_VALUES values;
 *   `category_values` = every distinct non-empty value with its count when distinct <= CATEGORY_MAX_DISTINCT
 *   (rules + jev candidates); collapsed character-shape histogram (top PROFILE_SHAPES_PER_COLUMN);
 *   candidate date formats with match counts (all 12 formats); numeric-grammar matches per separator convention
 *   (NUMBER_CONVENTIONS, every currency marker allowed, parens on); whitespace counts (end padding, interior runs,
 *   NBSP, zero-width); leading-zero count; formula-like count; null-token counts.
 * Table level: exact duplicate-row count and duplicate-after-trim count (whole records, every column).
 * Ordering is deterministic everywhere: counts descending, then value by UTF-16 code unit order.
 */

import {
  CATEGORY_MAX_DISTINCT,
  CURRENCY_MARKERS,
  DATE_FORMATS,
  FORMULA_PREFIXES,
  NBSP,
  NULL_TOKENS,
  NUMBER_CONVENTIONS,
  PROFILE_SHAPES_PER_COLUMN,
  PROFILE_TOP_VALUES,
  TRIM_WHITESPACE_CHARS,
  ZERO_WIDTH_CHARS,
  type DateFormat,
  type DecimalSeparator,
  type NullToken,
  type ThousandsSeparator,
} from '../constants.ts';
import type { ColumnId, Table } from '../table.ts';
import { parseDateCell } from '../transformkit/grammar/date.ts';
import { parseNumberCell } from '../transformkit/grammar/number.ts';
import { duplicatePositions, rowKey } from '../transformkit/ops/drop_duplicate_rows.ts';
import { FULL_TRIM, trimValue } from '../transformkit/ops/trim_whitespace.ts';
import { collapsedShape } from './shapes.ts';

export interface ValueCount {
  readonly value: string;
  readonly count: number;
}

export interface ShapeCount {
  readonly shape: string;
  readonly count: number;
}

export interface DateFormatCount {
  readonly format: DateFormat;
  readonly count: number;
}

export interface NumberConventionCount {
  readonly decimal: DecimalSeparator;
  readonly thousands: ThousandsSeparator;
  readonly count: number;
}

export interface NullTokenCount {
  readonly token: NullToken;
  readonly count: number;
}

export interface WhitespaceCounts {
  /** Cells with TRIM_WHITESPACE_CHARS at either end. */
  readonly padded: number;
  /** Cells with an interior run of 2+ spaces/tabs, or an interior tab. */
  readonly inner_runs: number;
  /** Cells containing U+00A0. */
  readonly nbsp: number;
  /** Cells containing U+200B..U+200D or U+FEFF. */
  readonly zero_width: number;
}

export interface ColumnProfile {
  readonly id: ColumnId;
  readonly name: string;
  readonly index: number;
  readonly present: number;
  readonly missing: number;
  readonly empty: number;
  readonly non_empty: number;
  readonly distinct: number;
  readonly top_values: readonly ValueCount[];
  /** All distinct non-empty values when distinct <= CATEGORY_MAX_DISTINCT; otherwise null. */
  readonly category_values: readonly ValueCount[] | null;
  readonly shapes: readonly ShapeCount[];
  readonly date_formats: readonly DateFormatCount[];
  readonly number_conventions: readonly NumberConventionCount[];
  readonly whitespace: WhitespaceCounts;
  /** Non-empty cells whose number part starts with "0" followed by a digit (after an optional sign). */
  readonly leading_zero: number;
  readonly formula_like: number;
  readonly null_tokens: readonly NullTokenCount[];
}

export interface LocalProfile {
  readonly version: 1;
  readonly records: number;
  readonly columns: readonly ColumnProfile[];
  readonly exact_duplicate_rows: number;
  readonly duplicate_rows_after_trim: number;
}

const END_CHARS: ReadonlySet<string> = new Set(TRIM_WHITESPACE_CHARS);
const ZERO_WIDTH: readonly string[] = ZERO_WIDTH_CHARS;
const NULL_TOKEN_SET: ReadonlySet<string> = new Set(NULL_TOKENS);
const PLAIN_SIGNED_NUMBER = /^[+-]?\d+([.,]\d+)?$/;
const LEADING_ZERO = /^[+-]?0\d/;

/** Deterministic ordering: count descending, then key ascending by UTF-16 code units. */
export function byCountThenKey<T>(key: (item: T) => string, count: (item: T) => number): (a: T, b: T) => number {
  return (a, b) => {
    const diff = count(b) - count(a);
    if (diff !== 0) return diff;
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
}

/** Distinct non-empty values of a column with counts, deterministically ordered. */
export function columnValueCounts(table: Table, columnIndex: number): ValueCount[] {
  const counts = new Map<string, number>();
  for (const row of table.rows) {
    if (columnIndex >= row.length) continue;
    const value = row[columnIndex];
    if (value === '') continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort(byCountThenKey<ValueCount>((v) => v.value, (v) => v.count));
}

export function isFormulaLike(value: string): boolean {
  if (value.length === 0) return false;
  if (!(FORMULA_PREFIXES as readonly string[]).includes(value[0])) return false;
  return !PLAIN_SIGNED_NUMBER.test(value);
}

function hasEndPadding(value: string): boolean {
  return value.length > 0 && (END_CHARS.has(value[0]) || END_CHARS.has(value[value.length - 1]));
}

function hasInnerRun(value: string): boolean {
  let start = 0;
  let end = value.length;
  while (start < end && END_CHARS.has(value[start])) start += 1;
  while (end > start && END_CHARS.has(value[end - 1])) end -= 1;
  const inner = value.slice(start, end);
  return inner.includes('  ') || inner.includes('\t');
}

export function exactDuplicateRows(table: Table): number {
  return duplicatePositions(table.rows).length;
}

export function duplicateRowsAfterTrim(table: Table): number {
  return duplicatePositions(table.rows, (row) => rowKey(row.map((cell) => trimValue(cell, FULL_TRIM)))).length;
}

const ALL_CURRENCIES = [...CURRENCY_MARKERS];

export function profileColumn(table: Table, index: number): ColumnProfile {
  const col = table.cols[index];
  let present = 0;
  let empty = 0;
  let padded = 0;
  let innerRuns = 0;
  let nbsp = 0;
  let zeroWidth = 0;
  let leadingZero = 0;
  let formulaLike = 0;
  const shapes = new Map<string, number>();
  const dateCounts = DATE_FORMATS.map(() => 0);
  const numberCounts = NUMBER_CONVENTIONS.map(() => 0);
  const nullCounts = new Map<string, number>();

  for (const row of table.rows) {
    if (index >= row.length) continue;
    present += 1;
    const value = row[index];
    if (value === '') {
      empty += 1;
      continue;
    }
    const shape = collapsedShape(value);
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
    if (hasEndPadding(value)) padded += 1;
    if (hasInnerRun(value)) innerRuns += 1;
    if (value.includes(NBSP)) nbsp += 1;
    if (ZERO_WIDTH.some((ch) => value.includes(ch))) zeroWidth += 1;
    if (LEADING_ZERO.test(value)) leadingZero += 1;
    if (isFormulaLike(value)) formulaLike += 1;
    if (NULL_TOKEN_SET.has(value)) nullCounts.set(value, (nullCounts.get(value) ?? 0) + 1);
    DATE_FORMATS.forEach((format, f) => {
      if (parseDateCell(value, format).ok) dateCounts[f] += 1;
    });
    NUMBER_CONVENTIONS.forEach((convention, k) => {
      const grammar = { ...convention, currency: ALL_CURRENCIES, parens_negative: true };
      if (parseNumberCell(value, grammar).ok) numberCounts[k] += 1;
    });
  }

  const values = columnValueCounts(table, index);
  return {
    id: col.id,
    name: col.name,
    index,
    present,
    missing: table.rows.length - present,
    empty,
    non_empty: present - empty,
    distinct: values.length,
    top_values: values.slice(0, PROFILE_TOP_VALUES),
    category_values: values.length <= CATEGORY_MAX_DISTINCT ? values : null,
    shapes: [...shapes]
      .map(([shape, count]) => ({ shape, count }))
      .sort(byCountThenKey<ShapeCount>((s) => s.shape, (s) => s.count))
      .slice(0, PROFILE_SHAPES_PER_COLUMN),
    date_formats: DATE_FORMATS.map((format, f) => ({ format, count: dateCounts[f] })),
    number_conventions: NUMBER_CONVENTIONS.map((c, k) => ({ decimal: c.decimal, thousands: c.thousands, count: numberCounts[k] })),
    whitespace: { padded, inner_runs: innerRuns, nbsp, zero_width: zeroWidth },
    leading_zero: leadingZero,
    formula_like: formulaLike,
    null_tokens: NULL_TOKENS.filter((token) => nullCounts.has(token)).map((token) => ({
      token,
      count: nullCounts.get(token) ?? 0,
    })),
  };
}

export function buildLocalProfile(table: Table): LocalProfile {
  return {
    version: 1,
    records: table.rows.length,
    columns: table.cols.map((_, index) => profileColumn(table, index)),
    exact_duplicate_rows: exactDuplicateRows(table),
    duplicate_rows_after_trim: duplicateRowsAfterTrim(table),
  };
}

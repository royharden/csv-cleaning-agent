/**
 * Outbound profile: the ONLY description of the file a model may see (C §1 item 2; PLAN.md M2 AC7). Pure.
 *
 * Contract:
 *  - Built AFTER column exclusion: excluded columns are absent (no id, label, value or statistic of theirs).
 *    The two table-level duplicate counts are whole-record aggregates (they read every column, like the
 *    drop_duplicate_rows op itself); they are numbers only.
 *  - Each included column is `{id: ColumnId, label}`; the label is the header screened for instruction-like text
 *    (withheld -> "[withheld]") and clipped to OUTBOUND_LABEL_MAX_CHARS. Labels are display only, never identity.
 *  - ONE shared allowance of at most OUTBOUND_VALUES_PER_COLUMN (8) unique strings per column: the `values` list
 *    is the only place cell text appears (samples, top values and category candidates all draw from it). Values
 *    are taken by count descending, then code-unit order; each is screened on the COMPLETE original string
 *    BEFORE clipping to OUTBOUND_VALUE_MAX_CHARS; withheld values are skipped (never sent, not even as a
 *    placeholder) and counted in `withheld_values`; clipped values carry `truncated: true`.
 *  - Everything else is counts, vocabulary constants (formats, conventions, null tokens) or shapes (shapes.ts:
 *    class letters and safe punctuation only).
 *  - Size: JSON.stringify(profile) must fit OUTBOUND_PROFILE_MAX_BYTES (UTF-8). If it does not, the allowance is
 *    lowered for all columns (8 -> 0), then shapes are dropped; each reduction is listed in `reductions` and the
 *    allowance actually used is `values_per_column`. `fits` is false only if even that is not enough.
 *  - Output is plain JSON data (canonical-JSON hashable for fixture keys / rulings in M3).
 */

import { z } from 'zod';
import {
  DATE_FORMATS,
  DECIMAL_SEPARATORS,
  MAX_COLUMNS,
  MAX_RECORDS,
  NULL_TOKENS,
  NUMBER_CONVENTIONS,
  OUTBOUND_LABEL_MAX_CHARS,
  OUTBOUND_PROFILE_MAX_BYTES,
  OUTBOUND_SHAPES_PER_COLUMN,
  OUTBOUND_VALUES_PER_COLUMN,
  OUTBOUND_VALUE_MAX_CHARS,
  THOUSANDS_SEPARATORS,
  type DateFormat,
  type DecimalSeparator,
  type NullToken,
  type ThousandsSeparator,
} from '../constants.ts';
import { utf8ByteLength } from '../journal/canonical.ts';
import { isColumnId, type ColumnId, type Table } from '../table.ts';
import { columnValueCounts, type ColumnProfile, type LocalProfile, type WhitespaceCounts } from './profile.ts';
import { isInstructionLike, screenForOutbound } from './withhold.ts';

export interface OutboundValue {
  readonly value: string;
  readonly count: number;
  readonly truncated?: true;
}

export interface OutboundColumn {
  readonly id: ColumnId;
  readonly label: string;
  readonly label_withheld?: true;
  readonly non_empty: number;
  readonly empty: number;
  readonly missing: number;
  readonly distinct: number;
  readonly values: readonly OutboundValue[];
  /** Distinct values of this column withheld as instruction-like. */
  readonly withheld_values: number;
  readonly shapes: readonly { readonly shape: string; readonly count: number }[];
  /** Formats with at least one matching cell. */
  readonly date_formats: readonly { readonly format: DateFormat; readonly count: number }[];
  /** Conventions with at least one matching cell. */
  readonly number_conventions: readonly {
    readonly decimal: DecimalSeparator;
    readonly thousands: ThousandsSeparator;
    readonly count: number;
  }[];
  readonly whitespace: WhitespaceCounts;
  readonly leading_zero: number;
  readonly formula_like: number;
  readonly null_tokens: readonly { readonly token: NullToken; readonly count: number }[];
}

export interface OutboundProfile {
  readonly version: 1;
  readonly records: number;
  readonly exact_duplicate_rows: number;
  readonly duplicate_rows_after_trim: number;
  /** Allowance actually used per column after the size budget (<= OUTBOUND_VALUES_PER_COLUMN). */
  readonly values_per_column: number;
  readonly columns: readonly OutboundColumn[];
}

// The model-boundary schema is shared with later planner/function contracts; every nested object is closed.
const Count = z.number().int().min(0).max(MAX_RECORDS);
const textWithin = (max: number) => z.string().refine((value) => Array.from(value).length <= max, `at most ${max} characters`);
const OutboundColumnSchema = z.object({
  id: z.string().refine(isColumnId, 'expected a ColumnId c0..c59'),
  label: textWithin(OUTBOUND_LABEL_MAX_CHARS),
  label_withheld: z.literal(true).optional(),
  non_empty: Count,
  empty: Count,
  missing: Count,
  distinct: Count,
  values: z.array(z.object({
    value: textWithin(OUTBOUND_VALUE_MAX_CHARS),
    count: Count,
    truncated: z.literal(true).optional(),
  }).strict()).max(OUTBOUND_VALUES_PER_COLUMN),
  withheld_values: Count,
  shapes: z.array(z.object({ shape: textWithin(OUTBOUND_VALUE_MAX_CHARS), count: Count }).strict()).max(OUTBOUND_SHAPES_PER_COLUMN),
  date_formats: z.array(z.object({ format: z.enum(DATE_FORMATS), count: Count }).strict()).max(DATE_FORMATS.length),
  number_conventions: z.array(z.object({
    decimal: z.enum(DECIMAL_SEPARATORS),
    thousands: z.enum(THOUSANDS_SEPARATORS),
    count: Count,
  }).strict()).max(NUMBER_CONVENTIONS.length),
  whitespace: z.object({ padded: Count, inner_runs: Count, nbsp: Count, zero_width: Count }).strict(),
  leading_zero: Count,
  formula_like: Count,
  null_tokens: z.array(z.object({ token: z.enum(NULL_TOKENS), count: Count }).strict()).max(NULL_TOKENS.length),
}).strict();

export const OutboundProfileSchema = z.object({
  version: z.literal(1),
  records: Count,
  exact_duplicate_rows: Count,
  duplicate_rows_after_trim: Count,
  values_per_column: z.number().int().min(0).max(OUTBOUND_VALUES_PER_COLUMN),
  columns: z.array(OutboundColumnSchema).max(MAX_COLUMNS),
}).strict().superRefine((profile, ctx) => {
  const seen = new Set<string>();
  profile.columns.forEach((column, index) => {
    if (seen.has(column.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['columns', index, 'id'], message: 'duplicate column id' });
    seen.add(column.id);
    if (column.values.length > profile.values_per_column) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['columns', index, 'values'], message: 'exceeds shared allowance' });
    }
  });
});

export interface OutboundBuild {
  readonly profile: OutboundProfile;
  /** UTF-8 bytes of JSON.stringify(profile). */
  readonly bytes: number;
  readonly fits: boolean;
  readonly reductions: readonly string[];
  /** Local-only counts for the UI ("N values withheld as instruction-like"). */
  readonly withheld_values_total: number;
  readonly withheld_labels: readonly ColumnId[];
  readonly excluded: readonly ColumnId[];
  /** ColumnIds included, in table order (the validator's `outboundColumnIds`). */
  readonly column_ids: readonly ColumnId[];
}

export interface OutboundOptions {
  readonly excludedColumnIds: readonly ColumnId[];
  /** Override for tests; defaults to OUTBOUND_PROFILE_MAX_BYTES. */
  readonly maxBytes?: number;
}

interface ColumnDraft {
  readonly base: Omit<OutboundColumn, 'values' | 'shapes'>;
  readonly values: readonly OutboundValue[];
  readonly shapes: readonly { readonly shape: string; readonly count: number }[];
}

function draftColumn(table: Table, column: ColumnProfile): { draft: ColumnDraft; labelWithheld: boolean } {
  const label = screenForOutbound(column.name, OUTBOUND_LABEL_MAX_CHARS);
  const values: OutboundValue[] = [];
  let withheld = 0;
  for (const { value, count } of columnValueCounts(table, column.index)) {
    if (isInstructionLike(value)) {
      withheld += 1;
      continue;
    }
    if (values.length >= OUTBOUND_VALUES_PER_COLUMN) continue;
    const screened = screenForOutbound(value, OUTBOUND_VALUE_MAX_CHARS);
    values.push(screened.truncated ? { value: screened.text, count, truncated: true } : { value: screened.text, count });
  }
  const base: Omit<OutboundColumn, 'values' | 'shapes'> = {
    id: column.id,
    label: label.text,
    ...(label.withheld ? { label_withheld: true as const } : {}),
    non_empty: column.non_empty,
    empty: column.empty,
    missing: column.missing,
    distinct: column.distinct,
    withheld_values: withheld,
    date_formats: column.date_formats.filter((d) => d.count > 0).map((d) => ({ format: d.format, count: d.count })),
    number_conventions: column.number_conventions
      .filter((n) => n.count > 0)
      .map((n) => ({ decimal: n.decimal, thousands: n.thousands, count: n.count })),
    whitespace: { ...column.whitespace },
    leading_zero: column.leading_zero,
    formula_like: column.formula_like,
    null_tokens: column.null_tokens.map((n) => ({ token: n.token, count: n.count })),
  };
  return {
    draft: {
      base,
      values,
      shapes: column.shapes.slice(0, OUTBOUND_SHAPES_PER_COLUMN).map((s) => ({ shape: s.shape, count: s.count })),
    },
    labelWithheld: label.withheld,
  };
}

function assemble(local: LocalProfile, drafts: readonly ColumnDraft[], allowance: number, withShapes: boolean): OutboundProfile {
  return {
    version: 1,
    records: local.records,
    exact_duplicate_rows: local.exact_duplicate_rows,
    duplicate_rows_after_trim: local.duplicate_rows_after_trim,
    values_per_column: allowance,
    columns: drafts.map((d) => ({
      ...d.base,
      values: d.values.slice(0, allowance),
      shapes: withShapes ? d.shapes : [],
    })),
  };
}

export function outboundBytes(profile: OutboundProfile): number {
  return utf8ByteLength(JSON.stringify(profile));
}

export function buildOutboundProfile(table: Table, local: LocalProfile, options: OutboundOptions): OutboundBuild {
  const maxBytes = options.maxBytes ?? OUTBOUND_PROFILE_MAX_BYTES;
  const excluded = new Set(options.excludedColumnIds);
  const drafts: ColumnDraft[] = [];
  const withheldLabels: ColumnId[] = [];
  let withheldTotal = 0;
  for (const column of local.columns) {
    if (excluded.has(column.id)) continue;
    const { draft, labelWithheld } = draftColumn(table, column);
    drafts.push(draft);
    withheldTotal += draft.base.withheld_values;
    if (labelWithheld) withheldLabels.push(column.id);
  }

  const reductions: string[] = [];
  let allowance = OUTBOUND_VALUES_PER_COLUMN;
  let withShapes = true;
  let profile = assemble(local, drafts, allowance, withShapes);
  let bytes = outboundBytes(profile);
  while (bytes > maxBytes && allowance > 0) {
    allowance -= 1;
    profile = assemble(local, drafts, allowance, withShapes);
    bytes = outboundBytes(profile);
  }
  if (allowance < OUTBOUND_VALUES_PER_COLUMN) {
    reductions.push(`values per column lowered from ${OUTBOUND_VALUES_PER_COLUMN} to ${allowance} to fit ${maxBytes} bytes`);
  }
  if (bytes > maxBytes) {
    withShapes = false;
    profile = assemble(local, drafts, allowance, withShapes);
    bytes = outboundBytes(profile);
    reductions.push('shape histograms dropped to fit the size budget');
  }

  return {
    profile: OutboundProfileSchema.parse(profile),
    bytes,
    fits: bytes <= maxBytes,
    reductions,
    withheld_values_total: withheldTotal,
    withheld_labels: withheldLabels,
    excluded: local.columns.filter((c) => excluded.has(c.id)).map((c) => c.id),
    column_ids: drafts.map((d) => d.base.id),
  };
}

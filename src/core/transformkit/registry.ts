/**
 * transformkit registry (PLAN.md M2, §8 item 12; C §2.4, §2.6). Pure; browser-, Node- and Deno-safe.
 *
 * Contract:
 *  - Defines the plan-step and delta TYPES every later layer uses: `PlanStep`, `Plan`, `StepDelta` (the journal
 *    `changes` / `dropped` / `header_change` / `mapping` shape of C §2.4; M3 `journal/events.ts` imports it),
 *    `ApplyResult`, `StepCounts`, `StepPreview`, `OpDefinition`, rejection codes.
 *  - `OPS` maps each of the eight op names to its definition `{schema, arity, check, preview, apply, invert}`.
 *    Every op is pure: `apply(table, step)` never mutates its input and returns `{table, delta, counts}`;
 *    `preview(table, step)` runs the SAME `apply` in memory and adds review samples; `invert(table, delta)` is
 *    journal-driven (it restores recorded values; it never re-derives the op) and throws on any mismatch.
 *  - `apply` assumes a step that passed `validator.ts`, but re-parses params and re-resolves columns itself and
 *    throws `OpError` instead of guessing when they are invalid.
 *  - Unchanged rows of the output table are shared with the input (both are readonly; never mutate either).
 *
 * Runtime imports only flow registry -> ops -> delta/grammar; the ops import registry for TYPES only, so there is
 * no runtime import cycle.
 */

import type { ZodTypeAny } from 'zod';
import type { OpName } from '../constants.ts';
import type { RowSample, DroppedSample } from '../review/samples.ts';
import type { LargestEdit } from '../review/editdistance.ts';
import type { ColumnId, Table } from '../table.ts';
import { invertDelta } from './delta.ts';
import { definition as dropDuplicateRows } from './ops/drop_duplicate_rows.ts';
import { definition as mapCategories } from './ops/map_categories.ts';
import { definition as normalizeCase } from './ops/normalize_case.ts';
import { definition as nullTokens } from './ops/null_tokens.ts';
import { definition as parseNumber } from './ops/parse_number.ts';
import { definition as renameHeaders } from './ops/rename_headers.ts';
import { definition as standardizeDate } from './ops/standardize_date.ts';
import { definition as trimWhitespace } from './ops/trim_whitespace.ts';

// ---------------------------------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------------------------------

/**
 * One plan step. Column references are ColumnIds ("c0".."c59"), never display labels. `params` is op-specific
 * (see schemas.ts); after validation it is the zod-parsed value. `human_edited` is NOT a step field: edit
 * provenance lives in the review/ruling record (M3) and is passed to the validator/guards as context.
 */
export interface PlanStep {
  readonly id: string;
  readonly op: OpName;
  readonly columns: readonly ColumnId[];
  readonly params: unknown;
  readonly rationale?: string;
}

export interface Plan {
  readonly version: 1;
  readonly steps: readonly PlanStep[];
}

// ---------------------------------------------------------------------------------------------------
// Deltas (journal `changes` shape, C §2.4)
// ---------------------------------------------------------------------------------------------------

/** Columnar cell changes; entry i is cell (rid[i], col[i]) going from old[i] to new[i]. Row-major, table order. */
export interface CellChanges {
  readonly rid: readonly number[];
  readonly col: readonly ColumnId[];
  readonly old: readonly string[];
  readonly new: readonly string[];
}

/** Rows removed by the step, at their actual width; positions are indices in the PREDECESSOR table, ascending. */
export interface DroppedRows {
  readonly rid: readonly number[];
  readonly rows: readonly (readonly string[])[];
  readonly positions: readonly number[];
}

/** Display-name changes; identity (ColumnId) never changes. */
export interface HeaderChange {
  readonly id: readonly ColumnId[];
  readonly old: readonly string[];
  readonly new: readonly string[];
}

/** The complete category mapping of a map_categories step, (from, to) pairs in group order (identity pairs omitted). */
export interface CategoryMapping {
  readonly column: ColumnId;
  readonly pairs: readonly (readonly [string, string])[];
}

/**
 * Everything needed to replay or reverse one step exactly (PLAN.md §8 item 12). Forward order of application:
 * header_change, changes, then dropped. `mapping` is informational (its cells are already in `changes`).
 */
export interface StepDelta {
  readonly changes: CellChanges;
  readonly dropped?: DroppedRows;
  readonly header_change?: HeaderChange;
  readonly mapping?: CategoryMapping;
}

// ---------------------------------------------------------------------------------------------------
// Apply results and previews
// ---------------------------------------------------------------------------------------------------

export interface StepCounts {
  /** Cells whose value changed. */
  readonly changed: number;
  /** Non-empty cells the op examined but deliberately left unchanged (grammar miss, length-changing case map). */
  readonly unparsed: number;
  readonly dropped: number;
  /** Column display names changed. */
  readonly headers: number;
  /**
   * Present cells the op examined (missing positions of ragged rows are never examined); for rename_headers the
   * number of columns named, for drop_duplicate_rows the number of records compared.
   */
  readonly examined: number;
}

export interface UnparsedCell {
  readonly rid: number;
  readonly col: ColumnId;
  readonly value: string;
}

export interface ApplyResult {
  readonly table: Table;
  readonly delta: StepDelta;
  readonly counts: StepCounts;
  /** First REVIEW_SAMPLE_ROWS unparsed cells in table order. */
  readonly unparsed_samples: readonly UnparsedCell[];
}

/** What a review card shows (spec item 6). Built from `apply` on the same predecessor; never an approximation. */
export interface StepPreview {
  readonly step_id: string;
  readonly op: OpName;
  readonly counts: StepCounts;
  /** Up to REVIEW_SAMPLE_ROWS changed rows, first in table order. */
  readonly samples: readonly RowSample[];
  readonly dropped_samples: readonly DroppedSample[];
  /** Up to REVIEW_LARGEST_EDITS largest exact Levenshtein edits, ties by (rid, column ordinal). */
  readonly largest_edits: readonly LargestEdit[];
  readonly unparsed_samples: readonly UnparsedCell[];
  readonly header_change?: HeaderChange;
  readonly mapping?: CategoryMapping;
  /** The full apply result (output table + delta), so Apply can reuse a fresh preview without re-running. */
  readonly result: ApplyResult;
}

// ---------------------------------------------------------------------------------------------------
// Op definitions
// ---------------------------------------------------------------------------------------------------

/** Machine-readable reason codes; each rejection also carries a human-readable reason string. */
export type RejectionCode =
  | 'plan_envelope'
  | 'too_many_steps'
  | 'not_object'
  | 'extra_keys'
  | 'missing_field'
  | 'bad_id'
  | 'duplicate_step_id'
  | 'unknown_op'
  | 'bad_columns'
  | 'unknown_column'
  | 'label_as_column'
  | 'excluded_column'
  | 'not_outbound'
  | 'duplicate_column'
  | 'arity'
  | 'params'
  | 'bad_rationale'
  | 'rationale_too_long'
  | 'not_observed'
  | 'header_empty'
  | 'header_collision'
  | 'apply_failed';

export interface Problem {
  readonly code: RejectionCode;
  readonly message: string;
}

/** Table-dependent validation context for `OpDefinition.check`. */
export interface CheckContext {
  /**
   * The step was edited locally by a human (provenance from the review record, M3). Only then may a
   * map_categories `to` be a value not observed in the predecessor (it then raises the category_target guard).
   */
  readonly humanEdited: boolean;
}

export interface OpArity {
  readonly min: number;
  readonly max: number;
}

export interface OpDefinition {
  readonly name: OpName;
  readonly version: number;
  /** zod `.strict()` params schema (schemas.ts). */
  readonly schema: ZodTypeAny;
  /** Allowed `columns.length`; whole-row ops use {min: 0, max: 0}. */
  readonly arity: OpArity;
  /** Checks that need the predecessor table (observed values, header collisions). Assumes params already parse. */
  readonly check: (table: Table, step: PlanStep, ctx: CheckContext) => Problem[];
  readonly apply: (table: Table, step: PlanStep) => ApplyResult;
  readonly preview: (table: Table, step: PlanStep) => StepPreview;
  readonly invert: (table: Table, delta: StepDelta) => Table;
}

export const OPS: Readonly<Record<OpName, OpDefinition>> = Object.freeze({
  rename_headers: renameHeaders,
  trim_whitespace: trimWhitespace,
  null_tokens: nullTokens,
  normalize_case: normalizeCase,
  parse_number: parseNumber,
  standardize_date: standardizeDate,
  map_categories: mapCategories,
  drop_duplicate_rows: dropDuplicateRows,
});

export function isOpName(value: unknown): value is OpName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(OPS, value);
}

export function getOp(name: OpName): OpDefinition {
  return OPS[name];
}

/** Dispatch `apply` by op name (pure). */
export function applyStep(table: Table, step: PlanStep): ApplyResult {
  return getOp(step.op).apply(table, step);
}

/** Dispatch `preview` by op name (pure; same engine as apply). */
export function previewOne(table: Table, step: PlanStep): StepPreview {
  return getOp(step.op).preview(table, step);
}

/** Journal-driven inverse of any step's delta (identical for every op). */
export function invertStep(table: Table, delta: StepDelta): Table {
  return invertDelta(table, delta);
}

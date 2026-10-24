/**
 * standardize_date (C §2.6 with PLAN.md row 3; PLAN.md M2 AC3). Pure.
 *
 * Params `{from_format: DateFormat}` (one of the 12 numeric whitelist formats); columns: 1..60.
 * A present non-empty cell that matches the STATED format (grammar/date.ts: tokenised, Gregorian-validated,
 * POSIX pivot 69 for YY) becomes YYYY-MM-DD; any other non-empty cell is left unchanged and counted as unparsed
 * (no per-cell guessing of another format). Empty cells are skipped. Guards: date_order (DD/MM and MM/DD
 * families only), two_digit_year (guards.ts).
 */

import { MAX_COLUMNS, OP_VERSION } from '../../constants.ts';
import type { Table } from '../../table.ts';
import {
  SAME,
  UNPARSED,
  buildPreview,
  invertDelta,
  mapColumnCells,
  parseParamsOrThrow,
  setTo,
  stepColumnIndices,
} from '../delta.ts';
import { parseDateCell } from '../grammar/date.ts';
import type { ApplyResult, OpDefinition, PlanStep, Problem, StepPreview } from '../registry.ts';
import { StandardizeDateParams } from '../schemas.ts';

export const schema = StandardizeDateParams;

export function check(_table: Table, _step: PlanStep): Problem[] {
  return [];
}

export function apply(table: Table, step: PlanStep): ApplyResult {
  const params = parseParamsOrThrow(schema, step);
  const columns = stepColumnIndices(table, step);
  return mapColumnCells(table, columns, (value) => {
    if (value === '') return SAME;
    const parsed = parseDateCell(value, params.from_format);
    return parsed.ok ? setTo(parsed.iso) : UNPARSED;
  });
}

export function preview(table: Table, step: PlanStep): StepPreview {
  return buildPreview(step, apply(table, step));
}

export const invert = invertDelta;

export const definition: OpDefinition = {
  name: 'standardize_date',
  version: OP_VERSION,
  schema,
  arity: { min: 1, max: MAX_COLUMNS },
  check,
  apply,
  preview,
  invert,
};

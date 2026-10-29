/**
 * parse_number (C §2.6; PLAN.md M2 AC2). Pure. String operations only (grammar/number.ts); this module performs
 * no numeric conversion of cell text, so nothing is rounded and long digit strings survive unchanged.
 *
 * Params `{decimal, thousands (!= decimal), currency: CurrencyMarker[], parens_negative}`; columns: 1..60.
 * A present non-empty cell that matches the stated grammar becomes its canonical `-?digits(.digits)?` form; a
 * non-matching cell is left unchanged and counted as unparsed (percentages, exponents, padded cells, ...). Empty
 * cells are skipped (neither changed nor unparsed). Guards: leading_zero_id, thousands_ambiguity (guards.ts).
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
import { parseNumberCell } from '../grammar/number.ts';
import type { ApplyResult, OpDefinition, PlanStep, Problem, StepPreview } from '../registry.ts';
import { ParseNumberParams } from '../schemas.ts';

export const schema = ParseNumberParams;

export function check(_table: Table, _step: PlanStep): Problem[] {
  return [];
}

export function apply(table: Table, step: PlanStep): ApplyResult {
  const params = parseParamsOrThrow(schema, step);
  const columns = stepColumnIndices(table, step);
  return mapColumnCells(table, columns, (value) => {
    if (value === '') return SAME;
    const parsed = parseNumberCell(value, params);
    return parsed.ok ? setTo(parsed.canonical) : UNPARSED;
  });
}

export function preview(table: Table, step: PlanStep): StepPreview {
  return buildPreview(step, apply(table, step));
}

export const invert = invertDelta;

export const definition: OpDefinition = {
  name: 'parse_number',
  version: OP_VERSION,
  schema,
  arity: { min: 1, max: MAX_COLUMNS },
  check,
  apply,
  preview,
  invert,
};

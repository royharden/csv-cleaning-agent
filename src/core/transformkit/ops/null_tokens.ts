/**
 * null_tokens (C §2.6, PLAN.md row 4). Pure.
 *
 * Params `{tokens: NullToken[]}` (a non-empty subset of the 15 NULL_TOKENS, no duplicates); columns: 1..60.
 * A present cell EXACTLY equal (case-sensitive, no implicit trim) to a selected token becomes the empty string.
 * Every other cell is untouched. Never counts unparsed cells. The null_shape_majority guard (guards.ts) decides
 * whether a token looks like real data in that column (e.g. "NA" = Namibia in a country-code column).
 */

import { MAX_COLUMNS, OP_VERSION } from '../../constants.ts';
import type { Table } from '../../table.ts';
import { SAME, buildPreview, invertDelta, mapColumnCells, parseParamsOrThrow, setTo, stepColumnIndices } from '../delta.ts';
import type { ApplyResult, OpDefinition, PlanStep, Problem, StepPreview } from '../registry.ts';
import { NullTokensParams } from '../schemas.ts';

export const schema = NullTokensParams;

export function check(_table: Table, _step: PlanStep): Problem[] {
  return [];
}

export function apply(table: Table, step: PlanStep): ApplyResult {
  const params = parseParamsOrThrow(schema, step);
  const tokens: ReadonlySet<string> = new Set(params.tokens);
  const columns = stepColumnIndices(table, step);
  return mapColumnCells(table, columns, (value) => (tokens.has(value) ? setTo('') : SAME));
}

export function preview(table: Table, step: PlanStep): StepPreview {
  return buildPreview(step, apply(table, step));
}

export const invert = invertDelta;

export const definition: OpDefinition = {
  name: 'null_tokens',
  version: OP_VERSION,
  schema,
  arity: { min: 1, max: MAX_COLUMNS },
  check,
  apply,
  preview,
  invert,
};

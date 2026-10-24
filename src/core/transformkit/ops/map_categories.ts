/**
 * map_categories (C §2.6). Pure.
 *
 * Params `{groups: [{from: string[], to: string}]}`; columns: exactly ONE ColumnId.
 *  - Simultaneous exact lookup: each present cell equal to a `from` value becomes that group's `to`; there is no
 *    chaining within a step (a `to` that is also another group's `from` is not re-mapped). A source value belongs
 *    to one group only (schema).
 *  - `check`: every `from` and every `to` must be an exact value OBSERVED in that column of the actual predecessor
 *    table. The only exception is a `to` introduced by a local human edit (`ctx.humanEdited`), which is allowed
 *    and raises the category_target guard instead. Truncated or withheld outbound values are not exact observed
 *    values, so a model cannot map them.
 *  - The full mapping (every from -> to pair, identity pairs omitted) is recorded in `delta.mapping`, and every
 *    changed cell in `delta.changes`.
 */

import { OP_VERSION } from '../../constants.ts';
import type { Table } from '../../table.ts';
import {
  SAME,
  buildPreview,
  invertDelta,
  mapColumnCells,
  parseParamsOrThrow,
  setTo,
  stepColumnIndices,
} from '../delta.ts';
import type { ApplyResult, CheckContext, OpDefinition, PlanStep, Problem, StepPreview } from '../registry.ts';
import { MapCategoriesParams } from '../schemas.ts';

export const schema = MapCategoriesParams;

/** Distinct present values of one column (by column index). */
export function observedValues(table: Table, columnIndex: number): Set<string> {
  const values = new Set<string>();
  for (const row of table.rows) if (columnIndex < row.length) values.add(row[columnIndex]);
  return values;
}

export function check(table: Table, step: PlanStep, ctx: CheckContext): Problem[] {
  const parsed = schema.safeParse(step.params);
  if (!parsed.success) return [];
  let indices: number[];
  try {
    indices = stepColumnIndices(table, step);
  } catch {
    return [];
  }
  if (indices.length !== 1) return [];
  const observed = observedValues(table, indices[0]);
  const column = table.cols[indices[0]].id;
  const problems: Problem[] = [];
  const missingFrom: string[] = [];
  const missingTo: string[] = [];
  for (const group of parsed.data.groups) {
    for (const source of group.from) if (!observed.has(source)) missingFrom.push(source);
    if (!observed.has(group.to) && !ctx.humanEdited) missingTo.push(group.to);
  }
  if (missingFrom.length > 0) {
    problems.push({
      code: 'not_observed',
      message: `from value(s) not observed in ${column}: ${missingFrom.map((v) => JSON.stringify(v)).join(', ')}`,
    });
  }
  if (missingTo.length > 0) {
    problems.push({
      code: 'not_observed',
      message: `to value(s) not observed in ${column} (invented category target): ${missingTo.map((v) => JSON.stringify(v)).join(', ')}`,
    });
  }
  return problems;
}

export function apply(table: Table, step: PlanStep): ApplyResult {
  const params = parseParamsOrThrow(schema, step);
  const columns = stepColumnIndices(table, step);
  const lookup = new Map<string, string>();
  const pairs: (readonly [string, string])[] = [];
  for (const group of params.groups) {
    for (const source of group.from) {
      lookup.set(source, group.to);
      if (source !== group.to) pairs.push([source, group.to]);
    }
  }
  const result = mapColumnCells(table, columns, (value) => {
    const target = lookup.get(value);
    return target === undefined ? SAME : setTo(target);
  });
  const column = columns.length > 0 ? table.cols[columns[0]].id : '';
  return { ...result, delta: { ...result.delta, mapping: { column, pairs } } };
}

export function preview(table: Table, step: PlanStep): StepPreview {
  return buildPreview(step, apply(table, step));
}

export const invert = invertDelta;

export const definition: OpDefinition = {
  name: 'map_categories',
  version: OP_VERSION,
  schema,
  arity: { min: 1, max: 1 },
  check,
  apply,
  preview,
  invert,
};

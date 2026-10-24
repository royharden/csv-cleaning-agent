/**
 * normalize_case (C §2.6, PLAN.md row 5; PLAN.md M2 AC4). Pure.
 *
 * Params `{mode: "upper" | "lower" | "title"}`; columns: 1..60.
 *  - Case maps always use the FIXED locale CASE_LOCALE ("en-US") via toLocaleUpperCase / toLocaleLowerCase, never
 *    the runtime default, so "José" -> "JOSÉ" and Turkish dotted/dotless i cannot vary by machine.
 *  - title: in each whitespace-separated word the first code point is upper-cased and the rest lower-cased;
 *    the whitespace between words is kept exactly.
 *  - A cell whose mapped result has a different length (UTF-16 code units; e.g. "ß" -> "SS") is LEFT UNCHANGED and
 *    counted as unparsed: case ops never change string length (PLAN.md row 5).
 */

import { CASE_LOCALE, MAX_COLUMNS, OP_VERSION, type CaseMode } from '../../constants.ts';
import type { Table } from '../../table.ts';
import {
  UNPARSED,
  buildPreview,
  invertDelta,
  mapColumnCells,
  parseParamsOrThrow,
  setTo,
  stepColumnIndices,
} from '../delta.ts';
import type { ApplyResult, OpDefinition, PlanStep, Problem, StepPreview } from '../registry.ts';
import { NormalizeCaseParams } from '../schemas.ts';

export const schema = NormalizeCaseParams;

export function upper(value: string): string {
  return value.toLocaleUpperCase(CASE_LOCALE);
}

export function lower(value: string): string {
  return value.toLocaleLowerCase(CASE_LOCALE);
}

function titleWord(word: string): string {
  const first = word.codePointAt(0);
  if (first === undefined) return word;
  const head = String.fromCodePoint(first);
  return upper(head) + lower(word.slice(head.length));
}

export function titleCase(value: string): string {
  // Split keeps the whitespace separators at odd indices.
  return value
    .split(/(\s+)/)
    .map((part, index) => (index % 2 === 1 || part.length === 0 ? part : titleWord(part)))
    .join('');
}

/** The mapped value, or null when the mapping would change the length (cell is left unchanged). */
export function caseValue(value: string, mode: CaseMode): string | null {
  const mapped = mode === 'upper' ? upper(value) : mode === 'lower' ? lower(value) : titleCase(value);
  return mapped.length === value.length ? mapped : null;
}

export function check(_table: Table, _step: PlanStep): Problem[] {
  return [];
}

export function apply(table: Table, step: PlanStep): ApplyResult {
  const params = parseParamsOrThrow(schema, step);
  const columns = stepColumnIndices(table, step);
  return mapColumnCells(table, columns, (value) => {
    const mapped = caseValue(value, params.mode);
    return mapped === null ? UNPARSED : setTo(mapped);
  });
}

export function preview(table: Table, step: PlanStep): StepPreview {
  return buildPreview(step, apply(table, step));
}

export const invert = invertDelta;

export const definition: OpDefinition = {
  name: 'normalize_case',
  version: OP_VERSION,
  schema,
  arity: { min: 1, max: MAX_COLUMNS },
  check,
  apply,
  preview,
  invert,
};

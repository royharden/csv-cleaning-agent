/**
 * trim_whitespace (C §2.6). Pure.
 *
 * Params `{ends: true, collapse_inner: bool, nbsp: bool, zero_width: bool}`; columns: 1..60 ColumnIds.
 * Per present cell, in this order:
 *   1. zero_width: remove U+200B, U+200C, U+200D, U+FEFF anywhere in the cell;
 *   2. nbsp: replace U+00A0 with an ASCII space;
 *   3. ends: remove TRIM_WHITESPACE_CHARS (space, tab, LF, CR, VT, FF) from both ends;
 *   4. collapse_inner: replace each interior run of spaces/tabs with ONE space (line breaks inside are kept).
 * No other interior change. Never counts unparsed cells.
 */

import { MAX_COLUMNS, NBSP, OP_VERSION, TRIM_WHITESPACE_CHARS, ZERO_WIDTH_CHARS } from '../../constants.ts';
import type { Table } from '../../table.ts';
import { buildPreview, invertDelta, mapColumnCells, parseParamsOrThrow, setTo, stepColumnIndices } from '../delta.ts';
import type { ApplyResult, OpDefinition, PlanStep, Problem, StepPreview } from '../registry.ts';
import { TrimWhitespaceParams, type TrimWhitespaceParamsT } from '../schemas.ts';

export const schema = TrimWhitespaceParams;

const END_CHARS: ReadonlySet<string> = new Set(TRIM_WHITESPACE_CHARS);
const ZERO_WIDTH: ReadonlySet<string> = new Set(ZERO_WIDTH_CHARS);

/** Every trim option on: what "duplicate after trim" means in the profile and the dedup_before_trim guard. */
export const FULL_TRIM: Readonly<TrimWhitespaceParamsT> = { ends: true, collapse_inner: false, nbsp: true, zero_width: true };

export function trimEnds(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && END_CHARS.has(value[start])) start += 1;
  while (end > start && END_CHARS.has(value[end - 1])) end -= 1;
  return start === 0 && end === value.length ? value : value.slice(start, end);
}

function collapseInner(value: string): string {
  let out = '';
  let inRun = false;
  for (const ch of value) {
    if (ch === ' ' || ch === '\t') {
      if (!inRun) out += ' ';
      inRun = true;
    } else {
      out += ch;
      inRun = false;
    }
  }
  return out;
}

export function trimValue(value: string, params: TrimWhitespaceParamsT): string {
  let v = value;
  if (params.zero_width) {
    let out = '';
    for (const ch of v) if (!ZERO_WIDTH.has(ch)) out += ch;
    v = out;
  }
  if (params.nbsp && v.includes(NBSP)) v = v.split(NBSP).join(' ');
  v = trimEnds(v);
  if (params.collapse_inner) v = collapseInner(v);
  return v;
}

export function check(_table: Table, _step: PlanStep): Problem[] {
  return [];
}

export function apply(table: Table, step: PlanStep): ApplyResult {
  const params = parseParamsOrThrow(schema, step);
  const columns = stepColumnIndices(table, step);
  return mapColumnCells(table, columns, (value) => setTo(trimValue(value, params)));
}

export function preview(table: Table, step: PlanStep): StepPreview {
  return buildPreview(step, apply(table, step));
}

export const invert = invertDelta;

export const definition: OpDefinition = {
  name: 'trim_whitespace',
  version: OP_VERSION,
  schema,
  arity: { min: 1, max: MAX_COLUMNS },
  check,
  apply,
  preview,
  invert,
};

/**
 * rename_headers (C §2.6). Pure.
 *
 * Params `{}`; columns: 1..60 ColumnIds whose display NAME becomes snake_case. Identity (ColumnId) never changes,
 * so later steps keep working. snake_case of a name:
 *   1. ASCII-fold Latin-1 letters U+00C0..U+00FF (NFD + drop combining marks; ß->ss, æ->ae, ø->o, ð->d, þ->th);
 *   2. every character that is not ASCII [A-Za-z0-9] becomes "_";
 *   3. runs of "_" collapse to one; leading/trailing "_" are removed; ASCII lowercase;
 *   4. a leading digit gets the prefix "c_".
 * `check` rejects (never guesses) when a renamed name would be empty, or would equal another final name (renamed
 * or untouched), listing the names. Only changed names are recorded in `header_change`.
 */

import { MAX_COLUMNS, OP_VERSION } from '../../constants.ts';
import type { Table } from '../../table.ts';
import {
  EMPTY_CHANGES,
  OpError,
  buildPreview,
  invertDelta,
  parseParamsOrThrow,
  stepColumnIndices,
} from '../delta.ts';
import type { ApplyResult, OpDefinition, PlanStep, Problem, StepPreview } from '../registry.ts';
import { RenameHeadersParams } from '../schemas.ts';

export const schema = RenameHeadersParams;

const SPECIAL_FOLDS: Readonly<Record<string, string>> = Object.freeze({
  'ß': 'ss',
  'æ': 'ae',
  'Æ': 'AE',
  'ø': 'o',
  'Ø': 'O',
  'ð': 'd',
  'Ð': 'D',
  'þ': 'th',
  'Þ': 'TH',
});

function foldLatin1(ch: string): string {
  const code = ch.charCodeAt(0);
  if (ch.length !== 1 || code < 0xc0 || code > 0xff) return ch;
  const special = SPECIAL_FOLDS[ch];
  if (special !== undefined) return special;
  // NFD splits e.g. "é" into "e" + U+0301; keep only ASCII letters of the decomposition.
  let out = '';
  for (const part of ch.normalize('NFD')) {
    const c = part.charCodeAt(0);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) out += part;
  }
  return out;
}

function isAsciiAlnum(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return ch.length === 1 && ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122));
}

export function snakeCase(name: string): string {
  let raw = '';
  for (const ch of name) {
    const folded = foldLatin1(ch);
    for (const f of folded.length === 0 ? '_' : folded) raw += isAsciiAlnum(f) ? f : '_';
  }
  let collapsed = '';
  for (const ch of raw) {
    if (ch === '_' && collapsed.endsWith('_')) continue;
    collapsed += ch;
  }
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === '_') start += 1;
  while (end > start && collapsed[end - 1] === '_') end -= 1;
  let result = collapsed.slice(start, end).toLowerCase();
  if (result.length > 0) {
    const first = result.charCodeAt(0);
    if (first >= 48 && first <= 57) result = `c_${result}`;
  }
  return result;
}

/** Final names after the step: renamed columns -> snake_case, others unchanged. Index-aligned with table.cols. */
function finalNames(table: Table, renamed: ReadonlySet<number>): string[] {
  return table.cols.map((col, index) => (renamed.has(index) ? snakeCase(col.name) : col.name));
}

export function check(table: Table, step: PlanStep): Problem[] {
  let indices: number[];
  try {
    indices = stepColumnIndices(table, step);
  } catch (error) {
    return [{ code: 'unknown_column', message: error instanceof Error ? error.message : String(error) }];
  }
  const renamed = new Set(indices);
  const names = finalNames(table, renamed);
  const problems: Problem[] = [];
  const empties = indices.filter((index) => names[index] === '');
  if (empties.length > 0) {
    problems.push({
      code: 'header_empty',
      message: `snake_case of ${empties.map((i) => `${table.cols[i].id} ${JSON.stringify(table.cols[i].name)}`).join(', ')} is empty`,
    });
  }
  const byName = new Map<string, number[]>();
  names.forEach((name, index) => {
    if (name === '') return;
    const list = byName.get(name);
    if (list === undefined) byName.set(name, [index]);
    else list.push(index);
  });
  for (const [name, list] of byName) {
    if (list.length < 2 || !list.some((index) => renamed.has(index))) continue;
    problems.push({
      code: 'header_collision',
      message: `${list.map((i) => `${table.cols[i].id} ${JSON.stringify(table.cols[i].name)}`).join(', ')} would all be named ${JSON.stringify(name)}`,
    });
  }
  return problems;
}

export function apply(table: Table, step: PlanStep): ApplyResult {
  parseParamsOrThrow(schema, step);
  const problems = check(table, step);
  if (problems.length > 0) throw new OpError(problems[0].code, `step ${step.id}: ${problems.map((p) => p.message).join('; ')}`);
  const indices = stepColumnIndices(table, step);
  const names = finalNames(table, new Set(indices));
  const id: string[] = [];
  const oldNames: string[] = [];
  const newNames: string[] = [];
  for (const index of indices) {
    if (names[index] === table.cols[index].name) continue;
    id.push(table.cols[index].id);
    oldNames.push(table.cols[index].name);
    newNames.push(names[index]);
  }
  const cols = id.length === 0 ? table.cols : table.cols.map((col, index) => ({ id: col.id, name: names[index] }));
  return {
    table: id.length === 0 ? table : { cols, rows: table.rows, rid: table.rid },
    delta: id.length === 0 ? { changes: EMPTY_CHANGES } : { changes: EMPTY_CHANGES, header_change: { id, old: oldNames, new: newNames } },
    counts: { changed: 0, unparsed: 0, dropped: 0, headers: id.length, examined: indices.length },
    unparsed_samples: [],
  };
}

export function preview(table: Table, step: PlanStep): StepPreview {
  return buildPreview(step, apply(table, step));
}

export const invert = invertDelta;

export const definition: OpDefinition = {
  name: 'rename_headers',
  version: OP_VERSION,
  schema,
  arity: { min: 1, max: MAX_COLUMNS },
  check,
  apply,
  preview,
  invert,
};

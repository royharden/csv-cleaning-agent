/**
 * Shared apply/invert engine for the eight ops (PLAN.md M2 AC1, C §2.5). Pure; browser-, Node- and Deno-safe.
 *
 * Contract:
 *  - `mapColumnCells` is the one cell-mapping loop every per-column op uses: row-major in table order, the step's
 *    columns in table order, missing positions (ragged rows) never examined or written. Output rows are copied
 *    only when they change; unchanged rows are shared with the input.
 *  - `invertDelta(table, delta)` reverses a recorded delta exactly (reinsert dropped rows at their recorded
 *    positions and widths, restore old cell values, restore old header names). It verifies that the table holds
 *    the recorded NEW values first and throws `DeltaMismatchError` otherwise; it never re-derives the op.
 *  - `applyDelta(table, delta)` is the forward twin (journal replay for M3 fold), with the same verification.
 *  - `buildPreview` turns an `ApplyResult` into the review card data (samples, largest exact edits).
 */

import type { ZodTypeAny } from 'zod';
import { REVIEW_LARGEST_EDITS, REVIEW_SAMPLE_ROWS } from '../constants.ts';
import { largestEdits } from '../review/editdistance.ts';
import { changedRowSamples, droppedRowSamples } from '../review/samples.ts';
import { columnIndexOf, isMissing, type ColumnId, type Column, type Table } from '../table.ts';
import type {
  ApplyResult,
  CellChanges,
  PlanStep,
  StepCounts,
  StepDelta,
  StepPreview,
  UnparsedCell,
} from './registry.ts';

/** A step that cannot be applied as written (invalid params, unknown column, header collision). */
export class OpError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OpError';
    this.code = code;
  }
}

/** A recorded delta does not match the table it is applied to / inverted on (journal inconsistency). */
export class DeltaMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeltaMismatchError';
  }
}

export const EMPTY_CHANGES: CellChanges = Object.freeze({
  rid: Object.freeze([]) as readonly number[],
  col: Object.freeze([]) as readonly ColumnId[],
  old: Object.freeze([]) as readonly string[],
  new: Object.freeze([]) as readonly string[],
});

/** Column indices for a step's ColumnIds, ascending (table order). Throws OpError on an unknown or repeated id. */
export function stepColumnIndices(table: Table, step: PlanStep): number[] {
  const seen = new Set<number>();
  for (const id of step.columns) {
    const index = columnIndexOf(table, id);
    if (index < 0) throw new OpError('unknown_column', `step ${step.id}: column ${String(id)} is not in the table`);
    if (seen.has(index)) throw new OpError('duplicate_column', `step ${step.id}: column ${id} is listed twice`);
    seen.add(index);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Parse params with the op's schema or throw OpError (apply never guesses). */
export function parseParamsOrThrow<S extends ZodTypeAny>(schema: S, step: PlanStep): S['_output'] {
  const parsed = schema.safeParse(step.params);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'params'}: ${issue.message}`).join('; ');
    throw new OpError('params', `step ${step.id}: invalid params for ${step.op}: ${detail}`);
  }
  return parsed.data;
}

/** Result of mapping one cell: keep it, set a new value, or leave it unchanged and count it as unparsed. */
export type CellOutcome = { readonly kind: 'same' } | { readonly kind: 'set'; readonly value: string } | { readonly kind: 'unparsed' };

export const SAME: CellOutcome = Object.freeze({ kind: 'same' });
export const UNPARSED: CellOutcome = Object.freeze({ kind: 'unparsed' });
export function setTo(value: string): CellOutcome {
  return { kind: 'set', value };
}

export function zeroCounts(examined = 0): StepCounts {
  return { changed: 0, unparsed: 0, dropped: 0, headers: 0, examined };
}

/**
 * The shared per-column cell loop. `fn(value, columnIndex)` is called for every PRESENT cell of the selected
 * columns; a 'set' outcome equal to the old value counts as unchanged.
 */
export function mapColumnCells(
  table: Table,
  columnIndices: readonly number[],
  fn: (value: string, columnIndex: number) => CellOutcome,
): ApplyResult {
  const rid: number[] = [];
  const col: ColumnId[] = [];
  const oldValues: string[] = [];
  const newValues: string[] = [];
  const unparsedSamples: UnparsedCell[] = [];
  let unparsed = 0;
  let examined = 0;
  let rows: (readonly string[])[] | null = null;

  for (let r = 0; r < table.rows.length; r += 1) {
    const row = table.rows[r];
    let copy: string[] | null = null;
    for (const c of columnIndices) {
      if (isMissing(row, c)) continue;
      examined += 1;
      const value = row[c];
      const outcome = fn(value, c);
      if (outcome.kind === 'unparsed') {
        unparsed += 1;
        if (unparsedSamples.length < REVIEW_SAMPLE_ROWS) {
          unparsedSamples.push({ rid: table.rid[r], col: table.cols[c].id, value });
        }
        continue;
      }
      if (outcome.kind === 'same' || outcome.value === value) continue;
      if (copy === null) copy = row.slice();
      copy[c] = outcome.value;
      rid.push(table.rid[r]);
      col.push(table.cols[c].id);
      oldValues.push(value);
      newValues.push(outcome.value);
    }
    if (copy !== null) {
      if (rows === null) rows = table.rows.slice();
      rows[r] = copy;
    }
  }

  return {
    table: rows === null ? table : { cols: table.cols, rows, rid: table.rid },
    delta: { changes: { rid, col, old: oldValues, new: newValues } },
    counts: { changed: rid.length, unparsed, dropped: 0, headers: 0, examined },
    unparsed_samples: unparsedSamples,
  };
}

function ridIndex(table: Table): Map<number, number> {
  const map = new Map<number, number>();
  table.rid.forEach((value, index) => map.set(value, index));
  return map;
}

function rowsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function setHeaders(cols: readonly Column[], ids: readonly ColumnId[], expect: readonly string[], to: readonly string[]): Column[] {
  if (ids.length !== expect.length || ids.length !== to.length) {
    throw new DeltaMismatchError('header_change arrays have different lengths');
  }
  const next = cols.map((c) => ({ id: c.id, name: c.name }));
  ids.forEach((id, i) => {
    const index = next.findIndex((c) => c.id === id);
    if (index < 0) throw new DeltaMismatchError(`header_change names unknown column ${id}`);
    if (next[index].name !== expect[i]) {
      throw new DeltaMismatchError(
        `column ${id} is named ${JSON.stringify(next[index].name)}, expected ${JSON.stringify(expect[i])}`,
      );
    }
    next[index] = { id, name: to[i] };
  });
  return next;
}

function setCells(
  table: Table,
  changes: CellChanges,
  expect: readonly string[],
  to: readonly string[],
): (readonly string[])[] {
  const n = changes.rid.length;
  if (changes.col.length !== n || expect.length !== n || to.length !== n) {
    throw new DeltaMismatchError('changes arrays have different lengths');
  }
  const rows = table.rows.slice();
  if (n === 0) return rows;
  const byRid = ridIndex(table);
  const copied = new Set<number>();
  for (let i = 0; i < n; i += 1) {
    const r = byRid.get(changes.rid[i]);
    if (r === undefined) throw new DeltaMismatchError(`changes name rid ${changes.rid[i]}, which is not in the table`);
    const c = columnIndexOf(table, changes.col[i]);
    if (c < 0) throw new DeltaMismatchError(`changes name unknown column ${changes.col[i]}`);
    const row = rows[r];
    if (isMissing(row, c)) {
      throw new DeltaMismatchError(`cell (${changes.rid[i]}, ${changes.col[i]}) is missing (ragged row); deltas never touch it`);
    }
    if (row[c] !== expect[i]) {
      throw new DeltaMismatchError(
        `cell (${changes.rid[i]}, ${changes.col[i]}) is ${JSON.stringify(row[c])}, expected ${JSON.stringify(expect[i])}`,
      );
    }
    let target: string[];
    if (copied.has(r)) {
      target = rows[r] as string[];
    } else {
      target = row.slice();
      rows[r] = target;
      copied.add(r);
    }
    target[c] = to[i];
  }
  return rows;
}

/** Forward replay of a recorded delta (journal fold). Verifies the recorded old values; throws on mismatch. */
export function applyDelta(table: Table, delta: StepDelta): Table {
  let cols: readonly Column[] = table.cols;
  if (delta.header_change !== undefined) {
    cols = setHeaders(table.cols, delta.header_change.id, delta.header_change.old, delta.header_change.new);
  }
  const rows = setCells(table, delta.changes, delta.changes.old, delta.changes.new);
  let rid: readonly number[] = table.rid;
  let outRows: readonly (readonly string[])[] = rows;
  const d = delta.dropped;
  if (d !== undefined) {
    if (d.rid.length !== d.rows.length || d.rid.length !== d.positions.length) {
      throw new DeltaMismatchError('dropped arrays have different lengths');
    }
    const drop = new Set<number>();
    for (let i = 0; i < d.positions.length; i += 1) {
      const position = d.positions[i];
      if (i > 0 && position <= d.positions[i - 1]) throw new DeltaMismatchError('dropped positions are not strictly ascending');
      if (position < 0 || position >= rows.length) throw new DeltaMismatchError(`dropped position ${position} is out of range`);
      if (table.rid[position] !== d.rid[i]) {
        throw new DeltaMismatchError(`row at position ${position} has rid ${table.rid[position]}, expected ${d.rid[i]}`);
      }
      if (!rowsEqual(rows[position], d.rows[i])) {
        throw new DeltaMismatchError(`row at position ${position} does not equal the recorded dropped row`);
      }
      drop.add(position);
    }
    outRows = rows.filter((_, index) => !drop.has(index));
    rid = table.rid.filter((_, index) => !drop.has(index));
  }
  return { cols, rows: outRows, rid };
}

/** Exact journal-driven inverse of a delta (C §2.5). Throws DeltaMismatchError if the table is not the step's output. */
export function invertDelta(table: Table, delta: StepDelta): Table {
  let rows: readonly (readonly string[])[] = table.rows;
  let rid: readonly number[] = table.rid;
  if (delta.dropped !== undefined) {
    const d = delta.dropped;
    if (d.rid.length !== d.rows.length || d.rid.length !== d.positions.length) {
      throw new DeltaMismatchError('dropped arrays have different lengths');
    }
    const present = new Set(table.rid);
    const outRows: (readonly string[])[] = [];
    const outRid: number[] = [];
    let k = 0;
    let src = 0;
    const total = table.rows.length + d.positions.length;
    for (let position = 0; position < total; position += 1) {
      if (k < d.positions.length && d.positions[k] === position) {
        if (present.has(d.rid[k])) throw new DeltaMismatchError(`dropped rid ${d.rid[k]} is already present`);
        outRows.push(d.rows[k].slice());
        outRid.push(d.rid[k]);
        k += 1;
      } else {
        if (src >= table.rows.length) throw new DeltaMismatchError('dropped positions do not fit the table');
        outRows.push(table.rows[src]);
        outRid.push(table.rid[src]);
        src += 1;
      }
    }
    if (k !== d.positions.length) throw new DeltaMismatchError('dropped positions are not ascending or out of range');
    rows = outRows;
    rid = outRid;
  }
  const restored: Table = { cols: table.cols, rows, rid };
  const cellRows = setCells(restored, delta.changes, delta.changes.new, delta.changes.old);
  let cols: readonly Column[] = table.cols;
  if (delta.header_change !== undefined) {
    cols = setHeaders(table.cols, delta.header_change.id, delta.header_change.new, delta.header_change.old);
  }
  return { cols, rows: cellRows, rid };
}

/** Review-card data for one apply result (the preview IS the apply, run in memory). */
export function buildPreview(step: PlanStep, result: ApplyResult): StepPreview {
  const { delta } = result;
  return {
    step_id: step.id,
    op: step.op,
    counts: result.counts,
    samples: changedRowSamples(delta, REVIEW_SAMPLE_ROWS),
    dropped_samples: droppedRowSamples(delta, REVIEW_SAMPLE_ROWS),
    largest_edits: largestEdits(delta.changes, REVIEW_LARGEST_EDITS),
    unparsed_samples: result.unparsed_samples,
    ...(delta.header_change === undefined ? {} : { header_change: delta.header_change }),
    ...(delta.mapping === undefined ? {} : { mapping: delta.mapping }),
    result,
  };
}

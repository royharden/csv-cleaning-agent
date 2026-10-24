/**
 * Core table model (C §2.4). Pure; no IO.
 *
 * - Column identity: `ColumnId` = "c0".."c59", assigned at parse in source order and immutable. The display
 *   header is the separate `name` field; `rename_headers` changes `name` only.
 * - Row identity: `rid` = original 0-based data-record index, carried through row drops.
 * - Rows are kept at their ACTUAL width (never padded or truncated). A position `>= rows[r].length` is
 *   MISSING, which is distinct from the empty string. Ops never write missing positions.
 */

import { MAX_COLUMNS } from './constants.ts';

/** "c0".."c59". A string alias; use `isColumnId` to validate untrusted input. */
export type ColumnId = string;

export interface Column {
  readonly id: ColumnId;
  readonly name: string;
}

export interface Table {
  readonly cols: readonly Column[];
  /** One entry per data record, each at its actual width (<= cols.length). */
  readonly rows: readonly (readonly string[])[];
  /** rid[r] is the original 0-based data-record index of rows[r]. */
  readonly rid: readonly number[];
}

const COLUMN_ID_PATTERN = /^c(?:0|[1-9][0-9]?)$/;

/** ColumnId for a 0-based source position. */
export function columnIdAt(index: number): ColumnId {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_COLUMNS) {
    throw new RangeError(`column index ${index} is outside 0..${MAX_COLUMNS - 1}`);
  }
  return `c${index}`;
}

/** True for "c0".."c59" exactly (no leading zeros, no labels). */
export function isColumnId(value: unknown): value is ColumnId {
  return typeof value === 'string' && COLUMN_ID_PATTERN.test(value) && Number(value.slice(1)) < MAX_COLUMNS;
}

/** Position of a column in `table.cols`, or -1. */
export function columnIndexOf(table: Table, id: ColumnId): number {
  return table.cols.findIndex((col) => col.id === id);
}

/** The cell value, or `undefined` when the position is missing (beyond the record's actual width). */
export function getCell(row: readonly string[], index: number): string | undefined {
  return index >= 0 && index < row.length ? row[index] : undefined;
}

export function isMissing(row: readonly string[], index: number): boolean {
  return index >= row.length;
}

/** Build a table; `rid` defaults to 0..n-1. Throws if the result violates the table invariants. */
export function createTable(
  cols: readonly Column[],
  rows: readonly (readonly string[])[],
  rid?: readonly number[],
): Table {
  const table: Table = { cols, rows, rid: rid ?? rows.map((_, index) => index) };
  assertValidTable(table);
  return table;
}

/** Every invariant violation, as human-readable strings (empty array = valid). */
export function validateTable(table: Table): string[] {
  const problems: string[] = [];
  if (table.cols.length > MAX_COLUMNS) {
    problems.push(`table has ${table.cols.length} columns; the limit is ${MAX_COLUMNS}`);
  }
  const seenIds = new Set<string>();
  table.cols.forEach((col, index) => {
    if (!isColumnId(col.id)) problems.push(`column ${index} has invalid id ${JSON.stringify(col.id)}`);
    if (seenIds.has(col.id)) problems.push(`duplicate column id ${col.id}`);
    seenIds.add(col.id);
    if (typeof col.name !== 'string') problems.push(`column ${col.id} name is not a string`);
  });
  if (table.rid.length !== table.rows.length) {
    problems.push(`rid has ${table.rid.length} entries for ${table.rows.length} rows`);
  }
  const seenRids = new Set<number>();
  table.rid.forEach((value, index) => {
    if (!Number.isSafeInteger(value) || value < 0) problems.push(`row ${index} has invalid rid ${String(value)}`);
    if (seenRids.has(value)) problems.push(`duplicate rid ${value}`);
    seenRids.add(value);
  });
  table.rows.forEach((row, index) => {
    if (row.length > table.cols.length) {
      problems.push(`row ${index} has width ${row.length}, wider than ${table.cols.length} columns`);
    }
    for (let c = 0; c < row.length; c += 1) {
      if (typeof row[c] !== 'string') {
        problems.push(`row ${index} position ${c} is not a string`);
        break;
      }
    }
  });
  return problems;
}

export function assertValidTable(table: Table): void {
  const problems = validateTable(table);
  if (problems.length > 0) {
    throw new Error(`invalid table: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ' ...' : ''}`);
  }
}

/** Deep copy with fresh arrays (cells are strings, so they are shared safely). */
export function cloneTable(table: Table): Table {
  return {
    cols: table.cols.map((col) => ({ id: col.id, name: col.name })),
    rows: table.rows.map((row) => row.slice()),
    rid: table.rid.slice(),
  };
}

/** Cell-for-cell equality including column ids/names, row widths (missing != empty) and rids. */
export function tablesEqual(a: Table, b: Table): boolean {
  if (a.cols.length !== b.cols.length || a.rows.length !== b.rows.length || a.rid.length !== b.rid.length) {
    return false;
  }
  for (let c = 0; c < a.cols.length; c += 1) {
    if (a.cols[c].id !== b.cols[c].id || a.cols[c].name !== b.cols[c].name) return false;
  }
  for (let r = 0; r < a.rid.length; r += 1) {
    if (a.rid[r] !== b.rid[r]) return false;
  }
  for (let r = 0; r < a.rows.length; r += 1) {
    const rowA = a.rows[r];
    const rowB = b.rows[r];
    if (rowA.length !== rowB.length) return false;
    for (let c = 0; c < rowA.length; c += 1) {
      if (rowA[c] !== rowB[c]) return false;
    }
  }
  return true;
}

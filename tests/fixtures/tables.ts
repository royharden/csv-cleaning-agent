/** Small table builders for core tests (no IO). */

import { columnIdAt, createTable, type Table } from '../../src/core/table.ts';

/** Header names -> c0..cN; rows kept at their given (possibly ragged) width; rid 0..n-1. */
export function makeTable(header: readonly string[], rows: readonly (readonly string[])[]): Table {
  return createTable(
    header.map((name, index) => ({ id: columnIdAt(index), name })),
    rows.map((row) => row.slice()),
  );
}

/** One-column table. */
export function columnTable(name: string, values: readonly string[]): Table {
  return makeTable([name], values.map((value) => [value]));
}

/** Every column of a table as a ColumnId list. */
export function allIds(table: Table): string[] {
  return table.cols.map((col) => col.id);
}

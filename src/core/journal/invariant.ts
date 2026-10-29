import type { Table } from '../table.ts';
import type { JournalEvent } from './events.ts';
import { fold } from './fold.ts';

export interface UnexplainedDifference {
  readonly kind: 'header' | 'cell' | 'row_presence' | 'row_order' | 'width';
  readonly rid?: number;
  readonly column?: string;
  readonly expected: unknown;
  readonly actual: unknown;
}
export interface InvariantReport {
  readonly unexplained: number;
  readonly differences: readonly UnexplainedDifference[];
  readonly journaled_cell_changes: number;
  readonly journaled_drops: number;
}

/** Fold verifies every old→new cell chain and dropped-row lineage, then compare the supplied table by rid. */
export async function invariant(input: Table, journal: readonly JournalEvent[], actual: Table): Promise<InvariantReport> {
  const { table: expected } = await fold(input, journal);
  const differences: UnexplainedDifference[] = [];
  for (let c = 0; c < Math.max(expected.cols.length, actual.cols.length); c += 1) {
    const a = actual.cols[c]; const e = expected.cols[c];
    if (a?.id !== e?.id || a?.name !== e?.name) differences.push({ kind: 'header', column: e?.id ?? a?.id, expected: e, actual: a });
  }
  const expectedRows = new Map(expected.rid.map((rid, r) => [rid, expected.rows[r]]));
  const actualRows = new Map(actual.rid.map((rid, r) => [rid, actual.rows[r]]));
  for (const rid of new Set([...expected.rid, ...actual.rid])) {
    const e = expectedRows.get(rid); const a = actualRows.get(rid);
    if (e === undefined || a === undefined) { differences.push({ kind: 'row_presence', rid, expected: e !== undefined, actual: a !== undefined }); continue; }
    if (e.length !== a.length) differences.push({ kind: 'width', rid, expected: e.length, actual: a.length });
    for (let c = 0; c < Math.max(e.length, a.length); c += 1) {
      if (e[c] !== a[c]) differences.push({ kind: 'cell', rid, column: expected.cols[c]?.id, expected: e[c], actual: a[c] });
    }
  }
  if (expected.rid.length === actual.rid.length) expected.rid.forEach((rid, r) => {
    if (rid !== actual.rid[r]) differences.push({ kind: 'row_order', rid, expected: r, actual: actual.rid.indexOf(rid) });
  });
  return { unexplained: differences.length, differences,
    journaled_cell_changes: journal.reduce((n, event) => n + (event.kind === 'apply' ? event.changes.rid.length : 0), 0),
    journaled_drops: journal.reduce((n, event) => n + (event.kind === 'apply' ? event.dropped?.rid.length ?? 0 : 0), 0) };
}

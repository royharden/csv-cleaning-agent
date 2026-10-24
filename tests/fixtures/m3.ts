import type { ParseMeta } from '../../src/core/csv/parse.ts';
import { createReviewState, decide, type ReviewState } from '../../src/core/review/state.ts';
import type { Table } from '../../src/core/table.ts';
import type { PlanStep } from '../../src/core/transformkit/registry.ts';

export const TIME = '2026-10-24T12:00:00.000Z';
export const trim: PlanStep = { id: 'trim', op: 'trim_whitespace', columns: ['c0'], params: { ends: true, collapse_inner: false, nbsp: true, zero_width: true } };
export const dedup: PlanStep = { id: 'dedup', op: 'drop_duplicate_rows', columns: [], params: {} };
export function metaFor(table: Table): ParseMeta {
  const ragged = table.rows.flatMap((row, rid) => row.length === table.cols.length ? [] : [{ rid, width: row.length }]);
  return { encoding: 'utf-8', bom: false, byte_length: 0, delimiter: ',', delimiter_source: 'detected', terminator: '\n',
    terminator_counts: { lf: table.rows.length + 1, crlf: 0, cr: 0 }, other_terminator_records: 0, trailing_terminator: true,
    records: table.rows.length, columns: table.cols.length, header_width: table.cols.length,
    ragged: { count: ragged.length, first: ragged.slice(0, 5) }, warnings: [] };
}
export async function approveAll(input: Table, steps: readonly PlanStep[]): Promise<ReviewState> {
  let state = await createReviewState(input, { version: 1, steps }, { outboundColumnIds: input.cols.map((c) => c.id), excludedColumnIds: [] });
  for (let index = 0; index < steps.length; index += 1) {
    for (const hit of state.cards[index].guards) state = await decide(state, { type: 'confirm', index, guard: hit.guard });
    state = await decide(state, { type: 'approve', index, decidedAt: TIME });
  }
  return state;
}

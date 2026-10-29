/**
 * drop_duplicate_rows (C §2.6). Pure.
 *
 * Params `{}`; columns: none (`[]`) - a whole-record op. It reads EVERY column, including columns excluded from the
 * outbound profile (local code; the UI says so). Two records are duplicates iff they have the same width and the
 * same value at every position (exact; no trimming, no case folding). The first occurrence in current table
 * order is kept; later ones are dropped and recorded in `delta.dropped` with their rid, actual-width values and
 * predecessor position, so undo reinserts them exactly. Guard: dedup_before_trim (guards.ts).
 */

import { OP_VERSION } from '../../constants.ts';
import type { Table } from '../../table.ts';
import { EMPTY_CHANGES, buildPreview, invertDelta, parseParamsOrThrow } from '../delta.ts';
import type { ApplyResult, OpDefinition, PlanStep, Problem, StepPreview } from '../registry.ts';
import { DropDuplicateRowsParams } from '../schemas.ts';

export const schema = DropDuplicateRowsParams;

/** Exact record key: JSON of the actual-width array (width and every value; unambiguous). */
export function rowKey(row: readonly string[]): string {
  return JSON.stringify(row);
}

/** Positions (ascending) of records that duplicate an earlier record under `key`. */
export function duplicatePositions(
  rows: readonly (readonly string[])[],
  key: (row: readonly string[]) => string = rowKey,
): number[] {
  const seen = new Set<string>();
  const positions: number[] = [];
  rows.forEach((row, position) => {
    const k = key(row);
    if (seen.has(k)) positions.push(position);
    else seen.add(k);
  });
  return positions;
}

export function check(_table: Table, _step: PlanStep): Problem[] {
  return [];
}

export function apply(table: Table, step: PlanStep): ApplyResult {
  parseParamsOrThrow(schema, step);
  const positions = duplicatePositions(table.rows);
  if (positions.length === 0) {
    return {
      table,
      delta: { changes: EMPTY_CHANGES },
      counts: { changed: 0, unparsed: 0, dropped: 0, headers: 0, examined: table.rows.length },
      unparsed_samples: [],
    };
  }
  const drop = new Set(positions);
  return {
    table: {
      cols: table.cols,
      rows: table.rows.filter((_, index) => !drop.has(index)),
      rid: table.rid.filter((_, index) => !drop.has(index)),
    },
    delta: {
      changes: EMPTY_CHANGES,
      dropped: {
        rid: positions.map((p) => table.rid[p]),
        rows: positions.map((p) => table.rows[p].slice()),
        positions,
      },
    },
    counts: { changed: 0, unparsed: 0, dropped: positions.length, headers: 0, examined: table.rows.length },
    unparsed_samples: [],
  };
}

export function preview(table: Table, step: PlanStep): StepPreview {
  return buildPreview(step, apply(table, step));
}

export const invert = invertDelta;

export const definition: OpDefinition = {
  name: 'drop_duplicate_rows',
  version: OP_VERSION,
  schema,
  arity: { min: 0, max: 0 },
  check,
  apply,
  preview,
  invert,
};

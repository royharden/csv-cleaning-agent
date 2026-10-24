/**
 * Deterministic review samples (spec item 6: "5 deterministic changed-row examples"; PLAN.md M2). Pure.
 *
 * Contract: samples are taken from a step's recorded delta, never from randomness. Changed-row samples are the
 * first `limit` distinct rows in delta order (row-major table order), each listing every changed cell of that
 * row in delta order. Dropped-row samples are the first `limit` dropped rows by predecessor position.
 */

import { REVIEW_SAMPLE_ROWS } from '../constants.ts';
import type { ColumnId } from '../table.ts';
import type { StepDelta } from '../transformkit/registry.ts';

export interface CellEdit {
  readonly col: ColumnId;
  readonly old: string;
  readonly new: string;
}

export interface RowSample {
  readonly rid: number;
  readonly cells: readonly CellEdit[];
}

export interface DroppedSample {
  readonly rid: number;
  /** Index in the predecessor table. */
  readonly position: number;
  /** The dropped record at its actual width. */
  readonly row: readonly string[];
}

export function changedRowSamples(delta: StepDelta, limit: number = REVIEW_SAMPLE_ROWS): RowSample[] {
  const { changes } = delta;
  const order: number[] = [];
  const byRid = new Map<number, CellEdit[]>();
  for (let i = 0; i < changes.rid.length; i += 1) {
    const rid = changes.rid[i];
    let cells = byRid.get(rid);
    if (cells === undefined) {
      if (order.length >= limit) continue;
      cells = [];
      byRid.set(rid, cells);
      order.push(rid);
    }
    cells.push({ col: changes.col[i], old: changes.old[i], new: changes.new[i] });
  }
  return order.map((rid) => ({ rid, cells: byRid.get(rid) ?? [] }));
}

export function droppedRowSamples(delta: StepDelta, limit: number = REVIEW_SAMPLE_ROWS): DroppedSample[] {
  const dropped = delta.dropped;
  if (dropped === undefined) return [];
  const out: DroppedSample[] = [];
  for (let i = 0; i < dropped.rid.length && out.length < limit; i += 1) {
    out.push({ rid: dropped.rid[i], position: dropped.positions[i], row: dropped.rows[i] });
  }
  return out;
}

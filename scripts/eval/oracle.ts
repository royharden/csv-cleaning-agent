/** Literal spec oracle and explicitly labelled operational extension; both are cumulative. */
import type { Table } from '../../src/core/table.ts';
import type { SeededDataset } from '../seededdirty/manifest.ts';
import { scoreDataset, type Score } from './scorer.ts';
export type ReviewMode = 'unreviewed' | 'oracle' | 'oracle+ops';
export interface OracleDecision { readonly keep: boolean; readonly reason: string; readonly cell_fixes: number }
/** A step fixes a cell only if it moves a present predecessor cell onto gold now. */
export function newlyFixed(before: Score, after: Score): number {
  const previous = new Map(before.outcomes.map((value) => [JSON.stringify([value.rid, value.column]), value]));
  return after.outcomes.filter((value) => {
    const old = previous.get(JSON.stringify([value.rid, value.column]));
    return !value.dropped && old !== undefined && !old.dropped && old.dirty !== old.clean && old.actual !== old.clean && value.actual === value.clean;
  }).length;
}
export function oracleDecision(data: SeededDataset, predecessor: Table, candidate: Table, mode: Exclude<ReviewMode, 'unreviewed'>): OracleDecision {
  const before = scoreDataset(data, predecessor); const after = scoreDataset(data, candidate);
  const fixes = newlyFixed(before, after);
  const old = new Map(before.outcomes.map((value) => [JSON.stringify([value.rid, value.column]), value]));
  const newlyWrong = after.outcomes.some((value) => {
    const prior = old.get(JSON.stringify([value.rid, value.column]));
    return !value.dropped && prior !== undefined && prior.dirty === prior.clean && value.actual !== prior.actual && value.actual !== value.clean;
  });
  // Literal criterion intentionally has no mangle/good-row-drop veto; those are labelled extensions.
  if (mode === 'oracle') return { keep: fixes > 0 && !newlyWrong, reason: newlyWrong ? 'changes a clean cell' : fixes > 0 ? 'fixes a cell' : 'no cell fix', cell_fixes: fixes };
  const mangle = after.outcomes.some((value) => {
    const prior = old.get(JSON.stringify([value.rid, value.column]));
    return !value.dropped && prior !== undefined && value.actual !== prior.actual && value.actual !== value.clean;
  });
  const badHeader = after.headers.mangled > before.headers.mangled || after.headers.wrongly_changed > before.headers.wrongly_changed;
  const dropsGood = after.good_rows_dropped.some((rid) => !before.good_rows_dropped.includes(rid));
  const structural = after.unexpected_columns.length > 0 || after.unexpected_rows.length > 0;
  const benefit = fixes > 0 || after.headers.fixed > before.headers.fixed || after.duplicates.removed > before.duplicates.removed;
  const keep = benefit && !newlyWrong && !mangle && !badHeader && !dropsGood && !structural;
  return { keep, cell_fixes: fixes, reason: keep ? 'safe cell/header/duplicate benefit' :
    newlyWrong ? 'changes a clean cell' : mangle ? 'mangles a cell' : badHeader ? 'damages a header' :
      dropsGood ? 'drops a good row' : structural ? 'unexpected structure' : 'no labelled benefit' };
}

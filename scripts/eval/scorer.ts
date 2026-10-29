/** Rid/ColumnId aligned scoring. A dropped error is unresolved, never a repaired cell. */
import type { OpName } from '../../src/core/constants.ts';
import type { ColumnId, Table } from '../../src/core/table.ts';
import type { DuplicateLabel, SeededDataset } from '../seededdirty/manifest.ts';

export type CellClass = 'fixed' | 'unfixed' | 'mangled' | 'wrongly_changed' | 'unchanged';
export interface CellOutcome {
  readonly rid: number; readonly column: ColumnId; readonly kind: CellClass;
  readonly dirty: string | undefined; readonly clean: string | undefined; readonly actual: string | undefined;
  readonly dropped: boolean; readonly trap?: string;
}
export interface Counts {
  fixed: number; unfixed: number; mangled: number; wrongly_changed: number; unchanged: number;
}
export interface Stratum { errors: number; fixed: number; mangled: number; recall: number | null }
export interface Score {
  readonly cells: Counts; readonly outcomes: readonly CellOutcome[];
  readonly all_errors: number; readonly fixable_errors: number; readonly fixable_fixed: number;
  readonly clean_cells: number; readonly dropped_dirty_cells: number;
  readonly rates: { fixed_all: number | null; fixed_fixable: number | null; mangled: number | null; wrongly_changed: number | null };
  readonly headers: Counts; readonly duplicates: { total: number; removed: number; recall: number | null };
  readonly good_rows_dropped: readonly number[]; readonly unexpected_rows: readonly number[];
  readonly unexpected_columns: readonly ColumnId[]; readonly unparsed: number;
  readonly categories: Readonly<Record<string, Stratum>>; readonly op_recall: Readonly<Partial<Record<OpName, Stratum>>>;
  readonly wrongly_changed: readonly CellOutcome[]; readonly missed_traps: readonly string[];
}
export function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
export function classify(dirty: string | undefined, clean: string | undefined, actual: string | undefined, dropped = false): CellClass {
  if (dirty === clean) return dropped || actual === clean ? 'unchanged' : 'wrongly_changed';
  if (dropped || actual === dirty) return 'unfixed';
  return actual === clean ? 'fixed' : 'mangled';
}
const counts = (): Counts => ({ fixed: 0, unfixed: 0, mangled: 0, wrongly_changed: 0, unchanged: 0 });
function rows(table: Table): Map<number, readonly string[]> { return new Map(table.rid.map((rid, i) => [rid, table.rows[i]])); }
function cell(table: Table, index: ReadonlyMap<number, readonly string[]>, rid: number, id: ColumnId): string | undefined {
  const c = table.cols.findIndex((column) => column.id === id);
  return c < 0 ? undefined : index.get(rid)?.[c];
}
/** Labels select ceilings and strata; gold values always come from the clean table + row_map. */
export function scoreDataset(data: SeededDataset, output: Table, unparsed = 0): Score {
  const dirtyRows = rows(data.dirty); const goldRows = rows(data.clean); const actualRows = rows(output);
  const rowMap = new Map(data.row_map.map((entry) => [entry.rid, entry.clean_rid]));
  const labels = new Map(data.labels.cells.map((label) => [JSON.stringify([label.rid, label.column]), label]));
  const duplicateIds = new Set(data.labels.duplicates.map((label) => label.rid));
  const result = counts(); const headers = counts(); const outcomes: CellOutcome[] = [];
  let allErrors = 0; let fixableErrors = 0; let fixableFixed = 0; let cleanCells = 0; let droppedDirty = 0;
  const categories: Record<string, Stratum> = {}; const opRecall: Partial<Record<OpName, Stratum>> = {};
  for (const rid of data.dirty.rid) {
    const cleanRid = rowMap.get(rid);
    if (cleanRid === undefined || !goldRows.has(cleanRid)) throw new Error(`Missing clean row lineage for rid ${rid}`);
    for (const column of data.dirty.cols) {
      const dirty = cell(data.dirty, dirtyRows, rid, column.id); const clean = cell(data.clean, goldRows, cleanRid, column.id);
      const actual = cell(output, actualRows, rid, column.id); const dropped = !actualRows.has(rid);
      const label = labels.get(JSON.stringify([rid, column.id]));
      const kind = classify(dirty, clean, actual, dropped);
      result[kind] += 1;
      const outcome: CellOutcome = { rid, column: column.id, dirty, clean, actual, dropped, kind,
        ...(label === undefined ? {} : { trap: label.trap }) };
      outcomes.push(outcome);
      if (dirty === clean) cleanCells += 1;
      else { allErrors += 1; if (dropped) droppedDirty += 1; }
      if (label?.label === 'fixable_by') { fixableErrors += 1; if (kind === 'fixed') fixableFixed += 1; }
      const strata: Stratum[] = [];
      if (label?.variant !== undefined) strata.push(categories[label.variant] ??= { errors: 0, fixed: 0, mangled: 0, recall: null });
      if (label?.fixable_by !== undefined) strata.push(opRecall[label.fixable_by] ??= { errors: 0, fixed: 0, mangled: 0, recall: null });
      for (const stratum of strata) {
        stratum.errors += 1; if (kind === 'fixed') stratum.fixed += 1; if (kind === 'mangled') stratum.mangled += 1;
      }
    }
  }
  for (const column of data.dirty.cols) {
    const gold = data.clean.cols.find((candidate) => candidate.id === column.id);
    const actual = output.cols.find((candidate) => candidate.id === column.id);
    headers[classify(column.name, gold?.name, actual?.name)] += 1;
  }
  for (const stratum of [...Object.values(categories), ...Object.values(opRecall)]) {
    if (stratum !== undefined) stratum.recall = rate(stratum.fixed, stratum.errors);
  }
  const duplicateRemoved = (label: DuplicateLabel): boolean => !actualRows.has(label.rid) && actualRows.has(label.retained_rid);
  const missedTraps = data.labels.traps.filter((trap) => {
    if (trap.expectation !== 'preserve' && trap.expectation !== 'repair') return false;
    const matches = outcomes.filter((value) => trap.rids.includes(value.rid) && trap.columns.includes(value.column));
    if (trap.expectation === 'preserve') return matches.some((value) => value.dropped || value.actual !== value.dirty);
    // Duplicate traps measure removal plus retained-row survival; dropped cell errors remain unfixed above.
    const duplicates = data.labels.duplicates.filter((label) => label.trap === trap.name);
    if (duplicates.length > 0) return duplicates.some((label) => !duplicateRemoved(label));
    return matches.some((value) => value.dirty !== value.clean && value.kind !== 'fixed') ||
      data.labels.headers.some((label) => label.trap === trap.name && output.cols.find((c) => c.id === label.column)?.name !== label.clean);
  }).map((trap) => trap.name);
  const removed = data.labels.duplicates.filter(duplicateRemoved).length;
  return { cells: result, outcomes, all_errors: allErrors, fixable_errors: fixableErrors, fixable_fixed: fixableFixed,
    clean_cells: cleanCells, dropped_dirty_cells: droppedDirty,
    rates: { fixed_all: rate(result.fixed, allErrors), fixed_fixable: rate(fixableFixed, fixableErrors),
      mangled: rate(result.mangled, allErrors), wrongly_changed: rate(result.wrongly_changed, cleanCells) },
    headers, duplicates: { total: duplicateIds.size, removed, recall: rate(removed, duplicateIds.size) },
    good_rows_dropped: data.dirty.rid.filter((rid) => !duplicateIds.has(rid) && !actualRows.has(rid)),
    unexpected_rows: output.rid.filter((rid) => !dirtyRows.has(rid)),
    unexpected_columns: output.cols.filter((column) => !data.dirty.cols.some((c) => c.id === column.id)).map((c) => c.id),
    unparsed, categories, op_recall: opRecall,
    wrongly_changed: outcomes.filter((value) => value.kind === 'wrongly_changed'), missed_traps: missedTraps };
}

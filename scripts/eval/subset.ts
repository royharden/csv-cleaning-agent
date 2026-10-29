/** Matched 200x6 population: column selection uses DEV error labels only, never held-out answers. */
import { createTable, type ColumnId, type Table } from '../../src/core/table.ts';
import type { Family, SeededDataset } from '../seededdirty/manifest.ts';
export interface SubsetSelection { readonly family: Family; readonly columns: readonly ColumnId[]; readonly dev_ids: readonly string[] }
export function selectSubsetColumns(dev: readonly SeededDataset[], family: Family): SubsetSelection {
  const datasets = dev.filter((data) => data.family === family && data.split === 'dev');
  if (datasets.length === 0) throw new Error(`No dev labels for ${family}; held-out column selection is forbidden.`);
  const counts = new Map<ColumnId, number>();
  for (const data of datasets) {
    for (const column of data.dirty.cols) if (!counts.has(column.id)) counts.set(column.id, 0);
    for (const label of data.labels.cells) counts.set(label.column, (counts.get(label.column) ?? 0) + 1);
  }
  const order = datasets[0].dirty.cols.map((column) => column.id);
  const columns = [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || order.indexOf(a) - order.indexOf(b)).slice(0, 6);
  if (columns.length !== 6) throw new Error(`${family} has fewer than six columns; cannot label a matched 200x6 population.`);
  return { family, columns, dev_ids: datasets.map((data) => data.id) };
}
function project(table: Table, columns: readonly ColumnId[], rids: ReadonlySet<number>): Table {
  // Source order preserves actual-width missing positions when projecting ragged records.
  const positions = table.cols.map((column, index) => ({ column, index })).filter(({ column }) => columns.includes(column.id));
  const selected = table.rid.flatMap((rid, index) => rids.has(rid) ? [{ rid, row: table.rows[index] }] : []);
  return createTable(positions.map(({ column }) => column), selected.map(({ row }) => positions.filter(({ index }) => index < row.length).map(({ index }) => row[index])), selected.map(({ rid }) => rid));
}
export function matchedSubset(data: SeededDataset, selection: SubsetSelection): SeededDataset {
  if (selection.family !== data.family) throw new Error('Subset selection family mismatch');
  const rids = new Set(data.dirty.rid.slice(0, 200));
  if (rids.size !== 200) throw new Error(`${data.id}: matched population needs 200 records`);
  const lineage = data.row_map.filter((entry) => rids.has(entry.rid));
  const cleanRids = new Set(lineage.map((entry) => entry.clean_rid));
  const cols = new Set(selection.columns);
  return { ...data, dirty: project(data.dirty, selection.columns, rids), clean: project(data.clean, selection.columns, cleanRids), row_map: lineage,
    labels: { cells: data.labels.cells.filter((label) => rids.has(label.rid) && cols.has(label.column)),
      headers: data.labels.headers.filter((label) => cols.has(label.column)),
      duplicates: data.labels.duplicates.filter((label) => rids.has(label.rid) && rids.has(label.retained_rid)),
      traps: data.labels.traps.map((trap) => ({ ...trap, rids: trap.rids.filter((rid) => rids.has(rid)), columns: trap.columns.filter((column) => cols.has(column)) }))
        .filter((trap) => trap.rids.length > 0 && trap.columns.length > 0) } };
}

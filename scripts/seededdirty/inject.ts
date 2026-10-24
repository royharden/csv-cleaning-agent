import type { OpName } from '../../src/core/constants.ts';
import type { CellLabel, DatasetLabels, HeaderLabel, RowMapEntry, TrapLabel, Variant } from './manifest.ts';

export interface InjectionState {
  clean: string[][];
  dirty: string[][];
  clean_headers: string[];
  dirty_headers: string[];
  cells: CellLabel[];
  headers: HeaderLabel[];
  duplicates: DatasetLabels['duplicates'][number][];
  traps: TrapLabel[];
  row_map: RowMapEntry[];
}

/** Each coordinate is injected once, keeping the final dirty-to-clean target unambiguous. */
export function injectCell(state: InjectionState, rid: number, column: number, dirty: string,
  trap: string, op?: OpName, variant?: Variant): void {
  const id = `c${column}`;
  if (state.cells.some((cell) => cell.rid === rid && cell.column === id)) {
    throw new Error(`Repeated injection at ${rid}/${id}`);
  }
  const clean = state.clean[rid][column];
  if (dirty === clean) throw new Error(`Injection ${trap} did not change ${rid}/${id}`);
  state.dirty[rid][column] = dirty;
  state.cells.push({ rid, column: id, dirty, clean, label: op === undefined ? 'out_of_scope' : 'fixable_by',
    ...(op === undefined ? {} : { fixable_by: op }), trap, ...(variant === undefined ? {} : { variant }) });
}

/** Set a clean ground-truth value before injecting a trap at this coordinate. */
export function plantValue(state: InjectionState, rid: number, column: number, value: string): void {
  state.clean[rid][column] = value;
  state.dirty[rid][column] = value;
}
export function markTrap(state: InjectionState, name: string, rids: readonly number[], columns: readonly number[],
  expectation: TrapLabel['expectation'], detail: string): void {
  state.traps.push({ name, rids, columns: columns.map((column) => `c${column}`), expectation, detail });
}

export function appendDuplicate(state: InjectionState, retainedRid: number, padded: boolean): void {
  const rid = state.dirty.length;
  // Duplicate targets refer to the clean retained row, including any pre-existing cell corruption on it.
  const row = state.dirty[retainedRid].slice();
  if (padded) row[1] = `  ${row[1]}  `;
  state.dirty.push(row);
  state.row_map.push({ rid, clean_rid: retainedRid, duplicate: true });
  state.duplicates.push({ rid, retained_rid: retainedRid, trap: padded ? 'padded-duplicate' : 'exact-duplicate' });
  row.forEach((dirty, column) => {
    const clean = state.clean[retainedRid][column];
    if (dirty !== clean) state.cells.push({ rid, column: `c${column}`, dirty, clean,
      label: 'fixable_by', fixable_by: 'trim_whitespace', trap: 'padded-duplicate' });
  });
  markTrap(state, padded ? 'padded-duplicate' : 'exact-duplicate', [retainedRid, rid], [1], 'repair',
    padded ? 'Equal only after trimming; keep original rid and drop appended rid.' : 'Exact duplicate; keep first rid.');
}

import type { OpName } from '../../src/core/constants.ts';
import type { ColumnId, Table } from '../../src/core/table.ts';

export const GENERATOR_VERSION = 'seededdirty-v1';
export const FAMILIES = ['customers', 'orders', 'inventory'] as const;
export const DEV_SEEDS = [1, 2, 3, 4] as const;
export const HELDOUT_SEEDS = [101, 102, 103, 104] as const;
export type Family = typeof FAMILIES[number];
export type Split = 'dev' | 'heldout';
export type Variant = 'case' | 'punctuation' | 'typo' | 'alias';

export interface CellLabel {
  readonly rid: number;
  readonly column: ColumnId;
  readonly dirty: string;
  readonly clean: string;
  readonly label: 'fixable_by' | 'out_of_scope';
  readonly fixable_by?: OpName;
  readonly trap: string;
  readonly variant?: Variant;
}
export interface HeaderLabel {
  readonly column: ColumnId;
  readonly dirty: string;
  readonly clean: string;
  readonly label: 'fixable_by' | 'out_of_scope';
  readonly fixable_by?: 'rename_headers';
  readonly trap: string;
}
export interface DuplicateLabel {
  readonly rid: number;
  readonly retained_rid: number;
  readonly trap: 'padded-duplicate' | 'exact-duplicate';
}
export interface TrapLabel {
  readonly name: string;
  readonly rids: readonly number[];
  readonly columns: readonly ColumnId[];
  readonly expectation: 'preserve' | 'repair' | 'withhold' | 'reject' | 'format';
  readonly detail: string;
}
export interface DatasetLabels {
  readonly cells: readonly CellLabel[];
  readonly headers: readonly HeaderLabel[];
  readonly duplicates: readonly DuplicateLabel[];
  readonly traps: readonly TrapLabel[];
}
export interface RowMapEntry {
  readonly rid: number;
  readonly clean_rid: number;
  readonly duplicate: boolean;
}
export interface SeededDataset {
  readonly id: string;
  readonly family: Family;
  readonly split: Split;
  readonly seed: number;
  readonly dirty: Table;
  readonly clean: Table;
  readonly labels: DatasetLabels;
  readonly row_map: readonly RowMapEntry[];
}
export interface FixtureFormat {
  readonly encoding: 'utf-8' | 'windows-1252';
  readonly delimiter: ',' | ';';
  readonly terminator: '\n' | '\r\n';
  readonly bom: boolean;
}
export type ArtifactKind = 'dirty' | 'clean' | 'labels';
export interface ManifestFile {
  readonly id: string;
  readonly family: Family;
  readonly split: Split;
  readonly seed: number;
  readonly rows: { readonly dirty: number; readonly clean: number };
  readonly columns: number;
  readonly paths: Readonly<Record<ArtifactKind, string>>;
  readonly sha256: Readonly<Record<ArtifactKind, string>>;
  readonly bytes: Readonly<Record<ArtifactKind, number>>;
  readonly row_map: readonly RowMapEntry[];
  readonly format: FixtureFormat;
}
export interface SeededManifest {
  readonly generator_version: typeof GENERATOR_VERSION;
  readonly seeds: { readonly dev: readonly number[]; readonly heldout: readonly number[] };
  /** Owner-supplied freeze date, never an invented construction-time date. */
  readonly freeze_date: string | null;
  readonly files: readonly ManifestFile[];
}

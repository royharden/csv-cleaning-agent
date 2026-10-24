/**
 * CSV export (C §2.4 export policy, PLAN.md M1 AC4 and row 12). Pure; browser- and Node-safe.
 *
 * - Detected delimiter and (majority) record terminator; trailing terminator re-emitted iff the input had one.
 * - Always UTF-8. The UTF-8 BOM is re-emitted only if the input had one (windows-1252 input exports as UTF-8).
 * - RFC 4180 quoting: a field is quoted iff it contains the delimiter, a double quote, CR or LF; inner quotes are
 *   doubled. Original quoting style is not preserved; byte-exact recovery is the retained original blob.
 * - Ragged records are written at their actual width (missing positions are not written).
 * - The header is written at its original width when the extra columns created by over-wide records still have
 *   empty names; otherwise every column name is written.
 */

import { UTF8_BOM_BYTES, type Delimiter, type Terminator } from '../constants.ts';
import type { Table } from '../table.ts';
import type { ParseMeta } from './parse.ts';

export interface SerializeOptions {
  readonly delimiter: Delimiter;
  readonly terminator: Terminator;
  readonly bom: boolean;
  readonly trailing_terminator: boolean;
  /** Original header width (ParseMeta.header_width); see the header rule above. */
  readonly header_width?: number;
}

/** Export options that reproduce the input's delimiter, terminator, BOM and trailing terminator. */
export function exportOptionsFromMeta(meta: ParseMeta): SerializeOptions {
  return {
    delimiter: meta.delimiter,
    terminator: meta.terminator,
    bom: meta.bom,
    trailing_terminator: meta.trailing_terminator,
    header_width: meta.header_width,
  };
}

export function needsQuoting(field: string, delimiter: Delimiter): boolean {
  return field.includes(delimiter) || field.includes('"') || field.includes('\r') || field.includes('\n');
}

export function quoteField(field: string, delimiter: Delimiter): string {
  return needsQuoting(field, delimiter) ? `"${field.split('"').join('""')}"` : field;
}

export function serializeRecord(fields: readonly string[], delimiter: Delimiter): string {
  return fields.map((field) => quoteField(field, delimiter)).join(delimiter);
}

function headerFields(table: Table, headerWidth: number | undefined): string[] {
  const names = table.cols.map((col) => col.name);
  if (headerWidth === undefined || headerWidth < 1 || headerWidth >= names.length) return names;
  for (let c = headerWidth; c < names.length; c += 1) {
    if (names[c] !== '') return names;
  }
  return names.slice(0, headerWidth);
}

/** The CSV text (without BOM; `encodeTable` adds it). */
export function serializeTable(table: Table, options: SerializeOptions): string {
  const records: string[] = [serializeRecord(headerFields(table, options.header_width), options.delimiter)];
  for (const row of table.rows) records.push(serializeRecord(row, options.delimiter));
  const text = records.join(options.terminator);
  return options.trailing_terminator ? text + options.terminator : text;
}

/** UTF-8 bytes of the export, with the BOM prepended iff `options.bom`. */
export function encodeTable(table: Table, options: SerializeOptions): Uint8Array {
  const body = new TextEncoder().encode(serializeTable(table, options));
  if (!options.bom) return body;
  const out = new Uint8Array(UTF8_BOM_BYTES.length + body.length);
  out.set(UTF8_BOM_BYTES, 0);
  out.set(body, UTF8_BOM_BYTES.length);
  return out;
}

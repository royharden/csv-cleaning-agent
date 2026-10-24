/**
 * Canonical serialisations used for hashing (C §2.4, PLAN.md M1 AC5). Pure; browser-, Node- and Deno-safe.
 *
 * 1) Canonical TABLE serialisation v1 — tagged, length-prefixed UTF-8:
 *
 *      canonical := "T1" ";" int(colCount) { str(col.id) str(col.name) }
 *                   int(recordCount) { int(rid) int(width) { str(cell) } }
 *      int(n)    := decimal ASCII digits of n (non-negative safe integer, no sign, no leading zeros) ";"
 *      str(s)    := decimal ASCII UTF-8 byte length of s ":" UTF-8 bytes of s
 *
 *    Records appear in current table order. `width` is the record's actual width; only present cells are
 *    written, so a missing position (beyond the width) is encoded by the width alone and differs from an
 *    empty string ("0:"). Delimiter, terminator, BOM, encoding and quoting are file metadata and are NOT part
 *    of the hash. Example: cols [c0 "a"], one record rid 0 ["1"]  ->  `T1;1;2:c01:a1;0;1;1:1`.
 *    Golden vectors: tests/fixtures/goldenVectors.ts.
 *
 * 2) Canonical JSON (for params_hash / event_hash, M3): no whitespace; object keys sorted by UTF-16 code unit
 *    order; properties whose value is `undefined` omitted (so a value hashes the same before and after a JSON
 *    round trip); strings and numbers formatted by JSON.stringify (-0 -> 0). Throws on non-finite numbers,
 *    bigint, functions, symbols, `undefined` inside arrays (incl. holes) and non-plain objects (Date, Map, ...).
 */

import { CANONICAL_VERSION } from '../constants.ts';
import type { Table } from '../table.ts';

/**
 * UTF-8 byte length, consistent with TextEncoder: a lone surrogate counts as U+FFFD (3 bytes).
 * (Text from TextDecoder never contains lone surrogates.)
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function pushInt(parts: string[], value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`canonical table: ${what} must be a non-negative safe integer, got ${String(value)}`);
  }
  parts.push(String(value), ';');
}

function pushStr(parts: string[], value: string): void {
  parts.push(String(utf8ByteLength(value)), ':', value);
}

/** Canonical table serialisation v1 as a string (its UTF-8 encoding is the hashed byte sequence). */
export function canonicalTableText(table: Table): string {
  if (table.rid.length !== table.rows.length) {
    throw new RangeError(`canonical table: rid has ${table.rid.length} entries for ${table.rows.length} rows`);
  }
  const parts: string[] = [CANONICAL_VERSION, ';'];
  pushInt(parts, table.cols.length, 'column count');
  for (const col of table.cols) {
    pushStr(parts, col.id);
    pushStr(parts, col.name);
  }
  pushInt(parts, table.rows.length, 'record count');
  for (let r = 0; r < table.rows.length; r += 1) {
    const row = table.rows[r];
    pushInt(parts, table.rid[r], 'rid');
    pushInt(parts, row.length, 'width');
    for (const cell of row) pushStr(parts, cell);
  }
  return parts.join('');
}

/** The exact byte sequence hashed for a table. */
export function canonicalTableBytes(table: Table): Uint8Array {
  return new TextEncoder().encode(canonicalTableText(table));
}

function writeJson(parts: string[], value: unknown, path: string): void {
  if (value === null) {
    parts.push('null');
    return;
  }
  switch (typeof value) {
    case 'boolean':
      parts.push(value ? 'true' : 'false');
      return;
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number at ${path}`);
      parts.push(JSON.stringify(value));
      return;
    case 'string':
      parts.push(JSON.stringify(value));
      return;
    case 'object':
      break;
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof value} at ${path}`);
  }
  if (Array.isArray(value)) {
    parts.push('[');
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) parts.push(',');
      const item: unknown = value[i];
      if (item === undefined) throw new TypeError(`canonicalJson: undefined array element at ${path}[${i}]`);
      writeJson(parts, item, `${path}[${i}]`);
    }
    parts.push(']');
    return;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`canonicalJson: non-plain object at ${path}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  parts.push('{');
  keys.forEach((key, index) => {
    if (index > 0) parts.push(',');
    parts.push(JSON.stringify(key), ':');
    writeJson(parts, record[key], `${path}.${key}`);
  });
  parts.push('}');
}

/** Canonical JSON text of a JSON-compatible value. */
export function canonicalJson(value: unknown): string {
  const parts: string[] = [];
  writeJson(parts, value, '$');
  return parts.join('');
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

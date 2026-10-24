/**
 * Canonical serialisation v1, canonical JSON and SHA-256 (PLAN.md M1 AC5, AC7; C §5.1).
 * Written in Dirty Mode; not executed yet. Hash assertions against `PENDING-first-run` vectors are skipped and
 * the computed digests are logged for re-keying (docs/DEFERRED-VALIDATION.md).
 */

import { describe, expect, it } from 'vitest';
import { parseBytes } from '../../src/core/csv/parse.ts';
import {
  canonicalJson,
  canonicalJsonBytes,
  canonicalTableBytes,
  canonicalTableText,
  utf8ByteLength,
} from '../../src/core/journal/canonical.ts';
import { hashCanonicalJson, hashTable, isSha256Hex, sha256Hex, sha256Text } from '../../src/core/journal/hash.ts';
import type { Table } from '../../src/core/table.ts';
import { CRLF_BYTES, LF_TWIN_OF_CRLF_BYTES } from '../fixtures/formatTorture.ts';
import { JSON_VECTORS, PENDING_FIRST_RUN, SHA256_KNOWN_VECTORS, TABLE_VECTORS } from '../fixtures/goldenVectors.ts';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function tableOf(bytes: Uint8Array): Table {
  const result = parseBytes(bytes);
  if (!result.ok) throw new Error(result.error.message);
  return result.table;
}

describe('canonical table serialisation v1: golden byte sequences', () => {
  for (const v of TABLE_VECTORS) {
    it(`matches the hand-derived sequence for "${v.name}"`, () => {
      expect(canonicalTableText(v.table)).toBe(v.canonical);
      const bytes = canonicalTableBytes(v.table);
      expect(Array.from(bytes)).toEqual(Array.from(new TextEncoder().encode(v.canonical)));
      expect(bytes.byteLength).toBe(v.byteLength);
      if (v.hex !== undefined) expect(toHex(bytes)).toBe(v.hex);
    });

    const pending = v.expected_sha256 === PENDING_FIRST_RUN;
    it.skipIf(pending)(`hashes "${v.name}" to its recorded SHA-256`, async () => {
      expect(await hashTable(v.table)).toBe(v.expected_sha256);
    });
  }

  it('logs digests of PENDING vectors for re-keying and checks their shape', async () => {
    for (const v of TABLE_VECTORS) {
      const digest = await hashTable(v.table);
      expect(isSha256Hex(digest)).toBe(true);
      if (v.expected_sha256 === PENDING_FIRST_RUN) console.log(`[golden table] ${v.name}: ${digest}`);
    }
  });
});

describe('canonical table serialisation v1: properties', () => {
  it('distinguishes a missing position from an empty string', () => {
    const cols = [
      { id: 'c0', name: 'a' },
      { id: 'c1', name: 'b' },
    ];
    const missing: Table = { cols, rows: [['1']], rid: [0] };
    const empty: Table = { cols, rows: [['1', '']], rid: [0] };
    expect(canonicalTableText(missing)).not.toBe(canonicalTableText(empty));
  });

  it('length-prefixes by UTF-8 bytes, not UTF-16 code units', () => {
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('€')).toBe(3);
    expect(utf8ByteLength('\u{1f600}')).toBe(4);
    expect(utf8ByteLength('\ud800')).toBe(new TextEncoder().encode('\ud800').length);
  });

  it('cannot be confused by separator characters inside values', () => {
    const a: Table = { cols: [{ id: 'c0', name: 'x' }], rows: [['1:a'], ['b']], rid: [0, 1] };
    const b: Table = { cols: [{ id: 'c0', name: 'x' }], rows: [['1'], [':ab']], rid: [0, 1] };
    expect(canonicalTableText(a)).not.toBe(canonicalTableText(b));
  });

  it('includes rid and record order', () => {
    const cols = [{ id: 'c0', name: 'x' }];
    const base: Table = { cols, rows: [['1'], ['2']], rid: [0, 1] };
    const otherRid: Table = { cols, rows: [['1'], ['2']], rid: [0, 2] };
    const swapped: Table = { cols, rows: [['2'], ['1']], rid: [1, 0] };
    expect(canonicalTableText(base)).not.toBe(canonicalTableText(otherRid));
    expect(canonicalTableText(base)).not.toBe(canonicalTableText(swapped));
  });

  it('excludes file metadata: CRLF and LF twins hash the same', async () => {
    const crlf = tableOf(CRLF_BYTES);
    const lf = tableOf(LF_TWIN_OF_CRLF_BYTES);
    expect(canonicalTableText(crlf)).toBe(canonicalTableText(lf));
    expect(await hashTable(crlf)).toBe(await hashTable(lf));
  });

  it('rejects a rid array that does not match the rows', () => {
    const bad: Table = { cols: [{ id: 'c0', name: 'x' }], rows: [['1']], rid: [] };
    expect(() => canonicalTableText(bad)).toThrow(RangeError);
  });
});

describe('canonical JSON', () => {
  for (const v of JSON_VECTORS) {
    it(`matches the golden text for "${v.name}"`, () => {
      expect(canonicalJson(v.value)).toBe(v.canonical);
      expect(Array.from(canonicalJsonBytes(v.value))).toEqual(Array.from(new TextEncoder().encode(v.canonical)));
    });

    const pending = v.expected_sha256 === PENDING_FIRST_RUN;
    it.skipIf(pending)(`hashes "${v.name}" to its recorded SHA-256`, async () => {
      expect(await hashCanonicalJson(v.value)).toBe(v.expected_sha256);
    });
  }

  it('logs digests of PENDING JSON vectors for re-keying', async () => {
    for (const v of JSON_VECTORS) {
      const digest = await hashCanonicalJson(v.value);
      expect(isSha256Hex(digest)).toBe(true);
      if (v.expected_sha256 === PENDING_FIRST_RUN) console.log(`[golden json] ${v.name}: ${digest}`);
    }
  });

  it('is stable across a JSON round trip', () => {
    const value = { z: [1, 'two', { b: false, a: null }], a: { nested: 'yes' }, gone: undefined };
    expect(canonicalJson(JSON.parse(JSON.stringify(value)))).toBe(canonicalJson(value));
  });

  it('throws on values that JSON cannot represent exactly', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson({ x: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => canonicalJson([1, undefined])).toThrow(TypeError);
    expect(() => canonicalJson(new Date(0))).toThrow(TypeError);
    expect(() => canonicalJson(new Map())).toThrow(TypeError);
    expect(() => canonicalJson(BigInt(1))).toThrow(TypeError);
    expect(() => canonicalJson(() => 1)).toThrow(TypeError);
  });
});

describe('SHA-256 via WebCrypto', () => {
  for (const v of SHA256_KNOWN_VECTORS) {
    it(`matches the published digest of ${JSON.stringify(v.input)}`, async () => {
      expect(await sha256Text(v.input)).toBe(v.sha256);
      expect(await sha256Hex(new TextEncoder().encode(v.input))).toBe(v.sha256);
    });
  }

  it('hashes a subarray view by its visible bytes only', async () => {
    const backing = new TextEncoder().encode('xabcx');
    expect(await sha256Hex(backing.subarray(1, 4))).toBe(SHA256_KNOWN_VECTORS[1].sha256);
  });
});

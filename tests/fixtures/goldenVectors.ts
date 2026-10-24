/**
 * Golden vectors for canonical serialisation v1 and canonical JSON (C §2.4, PLAN.md M1 AC5/AC7 and row 25).
 *
 * The canonical byte sequences below were derived BY HAND from the grammar in src/core/journal/canonical.ts;
 * `byteLength` was counted by hand (non-ASCII: é = 2 bytes, ß = 2 bytes). SHA-256 digests cannot be produced
 * without running code (Dirty Mode), so every `expected_sha256` is "PENDING-first-run": the first authorized
 * `npx vitest run tests/core/canonical.test.ts` logs the computed digests; paste them here, re-run, and the
 * hash assertions stop being skipped (docs/DEFERRED-VALIDATION.md). The same vectors must pass in Node and in
 * a real browser (browser/Node hash equality, deferred).
 *
 * The SHA-256 vectors at the bottom are the published FIPS 180-2 / NIST values, not derived here.
 */

import type { Table } from '../../src/core/table.ts';

export const PENDING_FIRST_RUN = 'PENDING-first-run';

export interface TableVector {
  readonly name: string;
  readonly table: Table;
  /** Canonical v1 text; its UTF-8 encoding is the hashed byte sequence. */
  readonly canonical: string;
  readonly byteLength: number;
  /** Hand-written hex of the full byte sequence, where short enough to write by hand. */
  readonly hex?: string;
  readonly expected_sha256: string;
}

export interface JsonVector {
  readonly name: string;
  readonly value: unknown;
  readonly canonical: string;
  readonly expected_sha256: string;
}

export const TABLE_VECTORS: readonly TableVector[] = [
  {
    name: 'empty table (no columns, no records)',
    table: { cols: [], rows: [], rid: [] },
    canonical: 'T1;0;0;',
    byteLength: 7,
    // T  1  ;  0  ;  0  ;
    hex: '54313b303b303b',
    expected_sha256: PENDING_FIRST_RUN,
  },
  {
    name: 'two by two with an empty cell',
    table: {
      cols: [
        { id: 'c0', name: 'a' },
        { id: 'c1', name: 'b' },
      ],
      rows: [
        ['1', '2'],
        ['', 'x'],
      ],
      rid: [0, 1],
    },
    // "T1;" "2;" "2:c0" "1:a" "2:c1" "1:b" "2;" | "0;" "2;" "1:1" "1:2" | "1;" "2;" "0:" "1:x"
    canonical: 'T1;2;2:c01:a2:c11:b2;0;2;1:11:21;2;0:1:x',
    byteLength: 40,
    expected_sha256: PENDING_FIRST_RUN,
  },
  {
    name: 'missing position differs from empty string',
    table: {
      cols: [
        { id: 'c0', name: 'a' },
        { id: 'c1', name: 'b' },
      ],
      rows: [['1'], ['1', '']],
      rid: [0, 1],
    },
    // record 0: width 1, one cell; record 1: width 2, second cell is "" ("0:")
    canonical: 'T1;2;2:c01:a2:c11:b2;0;1;1:11;2;1:10:',
    byteLength: 37,
    expected_sha256: PENDING_FIRST_RUN,
  },
  {
    name: 'non-ASCII, embedded newline, separator characters, non-contiguous rid',
    table: {
      cols: [
        { id: 'c0', name: 'José' },
        { id: 'c1', name: 'note' },
      ],
      rows: [
        ['ß', 'a\nb'],
        ['1:2;3', ''],
      ],
      rid: [0, 5],
    },
    // "T1;2;" "2:c0" "5:José" "2:c1" "4:note" "2;" | "0;2;" "2:ß" "3:a\nb" | "5;2;" "5:1:2;3" "0:"
    canonical: 'T1;2;2:c05:José2:c14:note2;0;2;2:ß3:a\nb5;2;5:1:2;30:',
    byteLength: 54,
    expected_sha256: PENDING_FIRST_RUN,
  },
  {
    name: 'header only with empty column names',
    table: {
      cols: [
        { id: 'c0', name: '' },
        { id: 'c1', name: 'x' },
        { id: 'c2', name: '' },
      ],
      rows: [],
      rid: [],
    },
    canonical: 'T1;3;2:c00:2:c11:x2:c20:0;',
    byteLength: 26,
    expected_sha256: PENDING_FIRST_RUN,
  },
];

export const JSON_VECTORS: readonly JsonVector[] = [
  {
    name: 'keys sorted, arrays kept in order',
    value: { b: 1, a: [true, null, 'x'] },
    canonical: '{"a":[true,null,"x"],"b":1}',
    expected_sha256: PENDING_FIRST_RUN,
  },
  {
    name: 'code-unit key order, escapes, -0 and decimals',
    value: { a: 'q"\\', B: 0, nested: { z: -0, y: 1.5 } },
    canonical: '{"B":0,"a":"q\\"\\\\","nested":{"y":1.5,"z":0}}',
    expected_sha256: PENDING_FIRST_RUN,
  },
  {
    name: 'undefined properties omitted, non-ASCII kept literally',
    value: { skip: undefined, keep: 'é' },
    canonical: '{"keep":"é"}',
    expected_sha256: PENDING_FIRST_RUN,
  },
  {
    name: 'empty containers',
    value: { list: [], map: {} },
    canonical: '{"list":[],"map":{}}',
    expected_sha256: PENDING_FIRST_RUN,
  },
];

/** Published SHA-256 test vectors (FIPS 180-2 Appendix B.1 for "abc"; the empty-string digest). */
export const SHA256_KNOWN_VECTORS: readonly { readonly input: string; readonly sha256: string }[] = [
  { input: '', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { input: 'abc', sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
];

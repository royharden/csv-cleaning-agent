/**
 * CSV decode / parse / serialize (PLAN.md M1 AC2-AC4, AC7; C §5.1 "Parser/format").
 * Written in Dirty Mode; not executed yet (docs/DEFERRED-VALIDATION.md).
 */

import { describe, expect, it } from 'vitest';
import { MAX_COLUMNS, MAX_INPUT_BYTES, MAX_RECORDS } from '../../src/core/constants.ts';
import { decode } from '../../src/core/csv/decode.ts';
import { detectDelimiter, parseBytes, type ParseResult } from '../../src/core/csv/parse.ts';
import {
  encodeTable,
  exportOptionsFromMeta,
  needsQuoting,
  quoteField,
  serializeTable,
} from '../../src/core/csv/serialize.ts';
import { tablesEqual } from '../../src/core/table.ts';
import {
  CRLF_BYTES,
  LF_TWIN_OF_CRLF_BYTES,
  TORTURE_FIXTURES,
  UTF16LE_BOM_BYTES,
  WINDOWS1252_REEXPORT_UTF8_BYTES,
} from '../fixtures/formatTorture.ts';

type ParseOk = Extract<ParseResult, { ok: true }>;

function mustParse(bytes: Uint8Array): ParseOk {
  const result = parseBytes(bytes);
  if (!result.ok) throw new Error(`expected a successful parse, got ${result.error.code}: ${result.error.message}`);
  return result;
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function fixture(name: string) {
  const found = TORTURE_FIXTURES.find((f) => f.name === name);
  if (found === undefined) throw new Error(`no fixture named ${name}`);
  return found;
}

describe('format torture: parse', () => {
  for (const f of TORTURE_FIXTURES) {
    it(`parses "${f.name}" with the expected metadata and cells`, () => {
      const { table, meta } = mustParse(f.bytes);
      const e = f.expect;
      expect(meta.encoding).toBe(e.encoding);
      expect(meta.bom).toBe(e.bom);
      expect(meta.delimiter).toBe(e.delimiter);
      expect(meta.delimiter_source).toBe(e.delimiterSource);
      expect(meta.terminator).toBe(e.terminator);
      expect(meta.trailing_terminator).toBe(e.trailingTerminator);
      expect(meta.other_terminator_records).toBe(e.otherTerminatorRecords);
      expect(meta.header_width).toBe(e.header.length);
      expect(meta.columns).toBe(e.columnNames.length);
      expect(meta.records).toBe(e.rows.length);
      expect(meta.byte_length).toBe(f.bytes.byteLength);
      expect(meta.ragged.count).toBe(e.raggedCount);
      expect(meta.ragged.first).toEqual(e.raggedFirst);
      expect(meta.warnings.map((w) => w.code)).toEqual(e.warningCodes);

      expect(table.cols.map((c) => c.name)).toEqual(e.columnNames);
      expect(table.cols.map((c) => c.id)).toEqual(e.columnNames.map((_, i) => `c${i}`));
      expect(table.rows).toEqual(e.rows);
      expect(table.rid).toEqual(e.rows.map((_, i) => i));
    });
  }

  it('counts CRLF inside a quoted field as content, not as a terminator', () => {
    const { meta } = mustParse(fixture('embedded newlines and escaped quotes inside quotes').bytes);
    expect(meta.terminator_counts).toEqual({ crlf: 0, lf: 4, cr: 0 });
  });

  it('reports terminator counts for a mixed file', () => {
    const { meta } = mustParse(fixture('mixed terminators (LF majority)').bytes);
    expect(meta.terminator_counts).toEqual({ crlf: 1, lf: 3, cr: 0 });
  });

  it('agrees with papaparse on record boundaries for malformed quoting (no record_count_mismatch)', () => {
    for (const name of [
      'malformed: quote inside an unquoted field',
      'malformed: text after a quote inside a quoted field',
      'malformed: unclosed quote',
    ]) {
      const { meta } = mustParse(fixture(name).bytes);
      const codes = meta.warnings.map((w) => w.code);
      expect(codes).toContain('malformed_quotes');
      expect(codes).not.toContain('record_count_mismatch');
    }
  });

  it('treats a quote followed by text inside a quoted field as content, not as the closing quote', () => {
    // The delimiter after the literal quote is inside the field; only the quote before ',' closes it.
    const { table } = mustParse(utf8('a,b\n"p"q,r",s\n'));
    expect(table.rows).toEqual([['p"q,r', 's']]);
  });

  it('rejects a UTF-16 byte order mark', () => {
    const result = parseBytes(UTF16LE_BOM_BYTES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported_encoding');
  });

  it('rejects an empty file and a BOM-only file', () => {
    const empty = parseBytes(new Uint8Array(0));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('empty_file');
    const bomOnly = parseBytes(Uint8Array.of(0xef, 0xbb, 0xbf));
    expect(bomOnly.ok).toBe(false);
    if (!bomOnly.ok) expect(bomOnly.error.code).toBe('empty_file');
  });

  it('uses a user-chosen delimiter instead of detection', () => {
    const result = parseBytes(fixture('semicolon delimiter with decimal comma').bytes, { delimiter: ',' });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.meta.delimiter).toBe(',');
    expect(result.meta.delimiter_source).toBe('user');
    expect(result.table.rows).toEqual([['1', '5;2;3']]);
  });
});

describe('delimiter detection (bounded sample)', () => {
  it('prefers the delimiter with the most records sharing one field count', () => {
    expect(detectDelimiter('a;b\n1,5;2,5\n3,0;4,0\n')).toEqual({ delimiter: ';', detected: true });
    expect(detectDelimiter('a|b|c\n1|2|3\n')).toEqual({ delimiter: '|', detected: true });
    expect(detectDelimiter('a\tb\n1\t2\n')).toEqual({ delimiter: '\t', detected: true });
  });

  it('ignores delimiters inside quoted fields', () => {
    expect(detectDelimiter('a;b\n"1,2,3";4\n"5,6,7";8\n')).toEqual({ delimiter: ';', detected: true });
  });

  it('falls back to "," for a single-column file', () => {
    expect(detectDelimiter('name\nAda\nGrace\n')).toEqual({ delimiter: ',', detected: false });
  });
});

describe('caps (named in the rejection message)', () => {
  it('rejects more than MAX_INPUT_BYTES before decoding', () => {
    const result = decode(new Uint8Array(MAX_INPUT_BYTES + 1).fill(0x61));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('cap_bytes');
      expect(result.error.cap).toEqual({ name: 'MAX_INPUT_BYTES', limit: MAX_INPUT_BYTES });
      expect(result.error.message).toContain('5,000,000');
    }
  });

  it('accepts exactly MAX_INPUT_BYTES', () => {
    expect(decode(new Uint8Array(MAX_INPUT_BYTES).fill(0x61)).ok).toBe(true);
  });

  it('accepts exactly MAX_RECORDS data records and rejects one more', () => {
    const atCap = mustParse(utf8(`id\n${'1\n'.repeat(MAX_RECORDS)}`));
    expect(atCap.meta.records).toBe(MAX_RECORDS);

    const over = parseBytes(utf8(`id\n${'1\n'.repeat(MAX_RECORDS + 1)}`));
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.error.code).toBe('cap_records');
      expect(over.error.cap).toEqual({ name: 'MAX_RECORDS', limit: MAX_RECORDS });
      expect(over.error.message).toContain('20,000');
    }
  });

  it('rejects one more record even without a trailing terminator', () => {
    const over = parseBytes(utf8(`id\n${'1\n'.repeat(MAX_RECORDS)}1`));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe('cap_records');
  });

  it('accepts MAX_COLUMNS header fields and rejects one more', () => {
    const header = (n: number) => Array.from({ length: n }, (_, i) => `h${i}`).join(',');
    expect(mustParse(utf8(`${header(MAX_COLUMNS)}\n`)).meta.columns).toBe(MAX_COLUMNS);

    const over = parseBytes(utf8(`${header(MAX_COLUMNS + 1)}\n`));
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.error.code).toBe('cap_columns');
      expect(over.error.cap).toEqual({ name: 'MAX_COLUMNS', limit: MAX_COLUMNS });
      expect(over.error.message).toContain('60 columns');
    }
  });

  it('counts an over-wide malformed record against the column cap', () => {
    const wide = Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => String(i)).join(',');
    const result = parseBytes(utf8(`a,b\n1,2\n${wide}\n`));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('cap_columns');
      expect(result.error.message).toContain('Data record 1');
    }
  });
});

describe('ragged records', () => {
  it('keeps every record at its actual width (never padded or truncated)', () => {
    const { table } = mustParse(fixture('ragged records (short and over-wide)').bytes);
    expect(table.rows.map((row) => row.length)).toEqual([2, 4, 3]);
  });

  it('preserves widths through serialize and re-parse', () => {
    const first = mustParse(fixture('ragged records (short and over-wide)').bytes);
    const text = serializeTable(first.table, exportOptionsFromMeta(first.meta));
    expect(text).toBe('a,b,c\n1,2\n1,2,3,4\n1,2,3\n');
    const second = mustParse(utf8(text));
    expect(second.table.rows.map((row) => row.length)).toEqual([2, 4, 3]);
    expect(tablesEqual(first.table, second.table)).toBe(true);
  });
});

describe('serialize', () => {
  it('quotes a field iff it contains the delimiter, a quote, CR or LF', () => {
    expect(needsQuoting('plain', ',')).toBe(false);
    expect(needsQuoting(' padded ', ',')).toBe(false);
    expect(needsQuoting('a,b', ',')).toBe(true);
    expect(needsQuoting('a,b', ';')).toBe(false);
    expect(needsQuoting('a;b', ';')).toBe(true);
    expect(needsQuoting('a\tb', '\t')).toBe(true);
    expect(needsQuoting('a|b', '|')).toBe(true);
    expect(needsQuoting('say "hi"', ',')).toBe(true);
    expect(needsQuoting('a\rb', ',')).toBe(true);
    expect(needsQuoting('a\nb', ',')).toBe(true);
    expect(quoteField('say "hi"', ',')).toBe('"say ""hi"""');
    expect(quoteField('', ',')).toBe('');
  });

  it('re-emits the UTF-8 BOM only when the input had one', () => {
    const withBom = mustParse(fixture('utf-8 BOM + CRLF').bytes);
    const out = encodeTable(withBom.table, exportOptionsFromMeta(withBom.meta));
    expect(Array.from(out.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);

    const noBom = mustParse(CRLF_BYTES);
    const out2 = encodeTable(noBom.table, exportOptionsFromMeta(noBom.meta));
    expect(out2[0]).toBe(0x61);
  });

  it('exports windows-1252 input as UTF-8 without a BOM', () => {
    const parsed = mustParse(fixture('windows-1252 0xE9 fallback').bytes);
    const out = encodeTable(parsed.table, exportOptionsFromMeta(parsed.meta));
    expect(Array.from(out)).toEqual(Array.from(WINDOWS1252_REEXPORT_UTF8_BYTES));
    const again = mustParse(out);
    expect(again.meta.encoding).toBe('utf-8');
    expect(tablesEqual(parsed.table, again.table)).toBe(true);
  });

  it('normalises a mixed-terminator file to its majority terminator (PLAN.md row 12)', () => {
    const parsed = mustParse(fixture('mixed terminators (LF majority)').bytes);
    expect(serializeTable(parsed.table, exportOptionsFromMeta(parsed.meta))).toBe('a,b\n1,2\n3,4\n5,6\n');
  });
});

describe('round trip: parse -> serialize -> parse', () => {
  for (const f of TORTURE_FIXTURES) {
    it(`is equal cell-for-cell for "${f.name}"`, () => {
      const first = mustParse(f.bytes);
      const options = exportOptionsFromMeta(first.meta);
      const bytes = encodeTable(first.table, options);
      const second = mustParse(bytes);
      expect(tablesEqual(first.table, second.table)).toBe(true);
      expect(second.meta.delimiter).toBe(first.meta.delimiter);
      expect(second.meta.terminator).toBe(first.meta.terminator);
      expect(second.meta.trailing_terminator).toBe(first.meta.trailing_terminator);
      expect(second.meta.bom).toBe(first.meta.bom);
      expect(second.meta.other_terminator_records).toBe(0);
      if (f.expect.reserializesExactly) {
        expect(Array.from(bytes)).toEqual(Array.from(f.bytes));
      }
    });
  }

  it('keeps a final lone empty record when there is no trailing terminator (writes "")', () => {
    const table = { cols: [{ id: 'c0', name: 'a' }], rows: [['x'], ['']], rid: [0, 1] };
    const options = { delimiter: ',' as const, terminator: '\n' as const, bom: false, trailing_terminator: false };
    const text = serializeTable(table, options);
    expect(text).toBe('a\nx\n""');
    const again = mustParse(utf8(text));
    expect(again.table.rows).toEqual([['x'], ['']]);
    expect(again.meta.trailing_terminator).toBe(false);
    expect(tablesEqual(table, again.table)).toBe(true);
  });

  it('does not quote a final lone empty record when the trailing terminator is kept', () => {
    const table = { cols: [{ id: 'c0', name: 'a' }], rows: [['x'], ['']], rid: [0, 1] };
    const options = { delimiter: ',' as const, terminator: '\n' as const, bom: false, trailing_terminator: true };
    expect(serializeTable(table, options)).toBe('a\nx\n\n');
    expect(mustParse(utf8('a\nx\n\n')).table.rows).toEqual([['x'], ['']]);
  });

  it('treats CRLF and LF twins as the same table (terminator is metadata)', () => {
    const crlf = mustParse(CRLF_BYTES);
    const lf = mustParse(LF_TWIN_OF_CRLF_BYTES);
    expect(tablesEqual(crlf.table, lf.table)).toBe(true);
    expect(crlf.meta.terminator).toBe('\r\n');
    expect(lf.meta.terminator).toBe('\n');
  });
});

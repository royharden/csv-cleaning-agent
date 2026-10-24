/**
 * Byte-exact format-torture fixtures (PLAN.md M1 and §8 item 10): plain Uint8Array literals, so no file IO,
 * git line-ending conversion or editor encoding can alter them. The comment above each array shows the text,
 * with escapes for control bytes. ASCII: \t 09, \n 0a, \r 0d, space 20, " 22, , 2c, ; 3b, | 7c, 0-9 30-39,
 * a-z 61-7a, A-Z 41-5a.
 */

import type { Delimiter, Encoding, Terminator } from '../../src/core/constants.ts';
import type { InputWarningCode } from '../../src/core/csv/decode.ts';

export interface TortureExpectation {
  readonly encoding: Encoding;
  readonly bom: boolean;
  readonly delimiter: Delimiter;
  readonly delimiterSource: 'detected' | 'default';
  readonly terminator: Terminator;
  readonly trailingTerminator: boolean;
  readonly otherTerminatorRecords: number;
  /** Header record as written in the file (header_width = its length). */
  readonly header: readonly string[];
  /** Column names after parse (header padded with '' up to the widest record). */
  readonly columnNames: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly raggedCount: number;
  readonly raggedFirst: readonly { readonly rid: number; readonly width: number }[];
  readonly warningCodes: readonly InputWarningCode[];
  /** encodeTable(parse(bytes)) reproduces the input bytes exactly. */
  readonly reserializesExactly: boolean;
}

export interface TortureFixture {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly expect: TortureExpectation;
}

// BOM + "id,name\r\n1,José\r\n"   (é = C3 A9)
const utf8BomCrlf = Uint8Array.of(
  0xef, 0xbb, 0xbf,
  0x69, 0x64, 0x2c, 0x6e, 0x61, 0x6d, 0x65, 0x0d, 0x0a,
  0x31, 0x2c, 0x4a, 0x6f, 0x73, 0xc3, 0xa9, 0x0d, 0x0a,
);

// "a,b\r\n1,2\r\n"
const crlf = Uint8Array.of(
  0x61, 0x2c, 0x62, 0x0d, 0x0a,
  0x31, 0x2c, 0x32, 0x0d, 0x0a,
);

// "a,b\n1,2\n3,4"   (no trailing terminator)
const lfNoTrailing = Uint8Array.of(
  0x61, 0x2c, 0x62, 0x0a,
  0x31, 0x2c, 0x32, 0x0a,
  0x33, 0x2c, 0x34,
);

// "a,b\n1,2\r\n3,4\n5,6\n"   (3 LF, 1 CRLF -> majority LF; 1 other-terminator record)
const mixedTerminators = Uint8Array.of(
  0x61, 0x2c, 0x62, 0x0a,
  0x31, 0x2c, 0x32, 0x0d, 0x0a,
  0x33, 0x2c, 0x34, 0x0a,
  0x35, 0x2c, 0x36, 0x0a,
);

// "a;b;c\n1,5;2;3\n"   (decimal comma inside a ';'-delimited file)
const semicolon = Uint8Array.of(
  0x61, 0x3b, 0x62, 0x3b, 0x63, 0x0a,
  0x31, 0x2c, 0x35, 0x3b, 0x32, 0x3b, 0x33, 0x0a,
);

// "a\tb\n1\t2\n"
const tab = Uint8Array.of(
  0x61, 0x09, 0x62, 0x0a,
  0x31, 0x09, 0x32, 0x0a,
);

// "a|b\n1|2\n"
const pipe = Uint8Array.of(
  0x61, 0x7c, 0x62, 0x0a,
  0x31, 0x7c, 0x32, 0x0a,
);

// "name\nCafé\n" in windows-1252 (é = E9, invalid as UTF-8)
const windows1252 = Uint8Array.of(
  0x6e, 0x61, 0x6d, 0x65, 0x0a,
  0x43, 0x61, 0x66, 0xe9, 0x0a,
);

// 'id,note\n1,"line1\nline2"\n2,"say ""hi"""\n3,"x\r\ny"\n'
// Embedded LF and CRLF inside quotes are cell content, not terminators.
const embeddedNewline = Uint8Array.of(
  0x69, 0x64, 0x2c, 0x6e, 0x6f, 0x74, 0x65, 0x0a,
  0x31, 0x2c, 0x22, 0x6c, 0x69, 0x6e, 0x65, 0x31, 0x0a, 0x6c, 0x69, 0x6e, 0x65, 0x32, 0x22, 0x0a,
  0x32, 0x2c, 0x22, 0x73, 0x61, 0x79, 0x20, 0x22, 0x22, 0x68, 0x69, 0x22, 0x22, 0x22, 0x0a,
  0x33, 0x2c, 0x22, 0x78, 0x0d, 0x0a, 0x79, 0x22, 0x0a,
);

// 'a,b\n" x, y ",z\n'   (quoted delimiter and significant spaces)
const quotedDelimiter = Uint8Array.of(
  0x61, 0x2c, 0x62, 0x0a,
  0x22, 0x20, 0x78, 0x2c, 0x20, 0x79, 0x20, 0x22, 0x2c, 0x7a, 0x0a,
);

// "a,b,c\n1,2\n1,2,3,4\n1,2,3\n"   (ragged: one short record, one over-wide record)
const ragged = Uint8Array.of(
  0x61, 0x2c, 0x62, 0x2c, 0x63, 0x0a,
  0x31, 0x2c, 0x32, 0x0a,
  0x31, 0x2c, 0x32, 0x2c, 0x33, 0x2c, 0x34, 0x0a,
  0x31, 0x2c, 0x32, 0x2c, 0x33, 0x0a,
);

// "a\n1\n\n2\n"   (single column; the blank line is a real record [""])
const blankLine = Uint8Array.of(
  0x61, 0x0a,
  0x31, 0x0a,
  0x0a,
  0x32, 0x0a,
);

// "a,b"   (header only, no terminator)
const headerOnly = Uint8Array.of(0x61, 0x2c, 0x62);

// Malformed quoting (M1 review carry-over). The structural scan follows papaparse's quote rule
// (src/core/csv/parse.ts `walk`), so both agree on record boundaries; each case warns `malformed_quotes`.

// 'a,b\n1,x"y\n'   (quote inside an unquoted field: literal content)
const quoteInUnquotedField = Uint8Array.of(
  0x61, 0x2c, 0x62, 0x0a,
  0x31, 0x2c, 0x78, 0x22, 0x79, 0x0a,
);

// 'a,b\n"x"y",z\n'   (text after a quote inside a quoted field: that quote is literal; the field closes at '",')
const textAfterInnerQuote = Uint8Array.of(
  0x61, 0x2c, 0x62, 0x0a,
  0x22, 0x78, 0x22, 0x79, 0x22, 0x2c, 0x7a, 0x0a,
);

// 'a,b\n1,"x\n2,y\n'   (unclosed quote: the rest of the file is one field; no trailing terminator outside quotes)
const unclosedQuote = Uint8Array.of(
  0x61, 0x2c, 0x62, 0x0a,
  0x31, 0x2c, 0x22, 0x78, 0x0a, 0x32, 0x2c, 0x79, 0x0a,
);

/** UTF-16LE BOM + "a": rejected as unsupported_encoding. */
export const UTF16LE_BOM_BYTES = Uint8Array.of(0xff, 0xfe, 0x61, 0x00);

/** BOM + "id,name\r\n1,José\r\n" re-exported for BOM-specific tests. */
export const UTF8_BOM_CRLF_BYTES = utf8BomCrlf;
/** "a,b\r\n1,2\r\n" and its LF twin (same table, different metadata). */
export const CRLF_BYTES = crlf;
export const LF_TWIN_OF_CRLF_BYTES = Uint8Array.of(0x61, 0x2c, 0x62, 0x0a, 0x31, 0x2c, 0x32, 0x0a);
/** "name\nCafé\n" in UTF-8 (é = C3 A9, no BOM): the expected re-export of the windows-1252 fixture. */
export const WINDOWS1252_REEXPORT_UTF8_BYTES = Uint8Array.of(
  0x6e, 0x61, 0x6d, 0x65, 0x0a,
  0x43, 0x61, 0x66, 0xc3, 0xa9, 0x0a,
);

const NONE: readonly InputWarningCode[] = [];

export const TORTURE_FIXTURES: readonly TortureFixture[] = [
  {
    name: 'utf-8 BOM + CRLF',
    bytes: utf8BomCrlf,
    expect: {
      encoding: 'utf-8', bom: true, delimiter: ',', delimiterSource: 'detected', terminator: '\r\n',
      trailingTerminator: true, otherTerminatorRecords: 0,
      header: ['id', 'name'], columnNames: ['id', 'name'], rows: [['1', 'José']],
      raggedCount: 0, raggedFirst: [], warningCodes: NONE, reserializesExactly: true,
    },
  },
  {
    name: 'CRLF',
    bytes: crlf,
    expect: {
      encoding: 'utf-8', bom: false, delimiter: ',', delimiterSource: 'detected', terminator: '\r\n',
      trailingTerminator: true, otherTerminatorRecords: 0,
      header: ['a', 'b'], columnNames: ['a', 'b'], rows: [['1', '2']],
      raggedCount: 0, raggedFirst: [], warningCodes: NONE, reserializesExactly: true,
    },
  },
  {
    name: 'LF without trailing terminator',
    bytes: lfNoTrailing,
    expect: {
      encoding: 'utf-8', bom: false, delimiter: ',', delimiterSource: 'detected', terminator: '\n',
      trailingTerminator: false, otherTerminatorRecords: 0,
      header: ['a', 'b'], columnNames: ['a', 'b'], rows: [['1', '2'], ['3', '4']],
      raggedCount: 0, raggedFirst: [], warningCodes: NONE, reserializesExactly: true,
    },
  },
  {
    name: 'mixed terminators (LF majority)',
    bytes: mixedTerminators,
    expect: {
      encoding: 'utf-8', bom: false, delimiter: ',', delimiterSource: 'detected', terminator: '\n',
      trailingTerminator: true, otherTerminatorRecords: 1,
      header: ['a', 'b'], columnNames: ['a', 'b'], rows: [['1', '2'], ['3', '4'], ['5', '6']],
      raggedCount: 0, raggedFirst: [], warningCodes: ['mixed_terminators'], reserializesExactly: false,
    },
  },
  {
    name: 'semicolon delimiter with decimal comma',
    bytes: semicolon,
    expect: {
      encoding: 'utf-8', bom: false, delimiter: ';', delimiterSource: 'detected', terminator: '\n',
      trailingTerminator: true, otherTerminatorRecords: 0,
      header: ['a', 'b', 'c'], columnNames: ['a', 'b', 'c'], rows: [['1,5', '2', '3']],
      raggedCount: 0, raggedFirst: [], warningCodes: NONE, reserializesExactly: true,
    },
  },
  {
    name: 'tab delimiter',
    bytes: tab,
    expect: {
      encoding: 'utf-8', bom: false, delimiter: '\t', delimiterSource: 'detected', terminator: '\n',
      trailingTerminator: true, otherTerminatorRecords: 0,
      header: ['a', 'b'], columnNames: ['a', 'b'], rows: [['1', '2']],
      raggedCount: 0, raggedFirst: [], warningCodes: NONE, reserializesExactly: true,
    },
  },
  {
    name: 'pipe delimiter',
    bytes: pipe,
    expect: {
      encoding: 'utf-8', bom: false, delimiter: '|', delimiterSource: 'detected', terminator: '\n',
      trailingTerminator: true, otherTerminatorRecords: 0,
      header: ['a', 'b'], columnNames: ['a', 'b'], rows: [['1', '2']],
      raggedCount: 0, raggedFirst: [], warningCodes: NONE, reserializesExactly: true,
    },
  },
  {
    name: 'windows-1252 0xE9 fallback',
    bytes: windows1252,
    expect: {
      encoding: 'windows-1252', bom: false, delimiter: ',', delimiterSource: 'default', terminator: '\n',
      trailingTerminator: true, otherTerminatorRecords: 0,
      header: ['name'], columnNames: ['name'], rows: [['Café']],
      raggedCount: 0, raggedFirst: [], warningCodes: ['windows1252_fallback', 'delimiter_defaulted'],
      reserializesExactly: false,
    },
  },
  {
    name: 'embedded newlines and escaped quotes inside quotes',
    bytes: embeddedNewline,
    expect: {
      encoding: 'utf-8', bom: false, delimiter: ',', delimiterSource: 'detected', terminator: '\n',
      trailingTerminator: true, otherTerminatorRecords: 0,
      header: ['id', 'note'], columnNames: ['id', 'note'],
      rows: [['1', 'line1\nline2'], ['2', 'say "hi"'], ['3', 'x\r\ny']],
      raggedCount: 0, raggedFirst: [], warningCodes: NONE, reserializesExactly: true,
    },
  },
  {
    name: 'quoted delimiter and significant spaces',
    bytes: quotedDelimiter,
    expect: {
      encoding: 'utf-8', bom: false, delimiter: ',', delimiterSource: 'detected', terminator: '\n',
      trailingTerminator: true, otherTerminatorRecords: 0,
      header: ['a', 'b'], columnNames: ['a', 'b'], rows: [[' x, y ', 'z']],
      raggedCount: 0, raggedFirst: [], warningCodes: NONE, reserializesExactly: true,
    },
  },
  {
    name: 'ragged records (short and over-wide)',
    bytes: ragged,
    expect: {
      encoding: 'utf-8', bom: false, delimiter: ',', delimiterSource: 'detected', terminator: '\n',
      trailingTerminator: true, otherTerminatorRecords: 0,
      header: ['a', 'b', 'c'], columnNames: ['a', 'b', 'c', ''],
      rows: [['1', '2'], ['1', '2', '3', '4'], ['1', '2', '3']],
      raggedCount: 2, raggedFirst: [{ rid: 0, width: 2 }, { rid: 1, width: 4 }],
      warningCodes: NONE, reserializesExactly: true,
    },
  },
  {
    name: 'blank line is a one-field record',
    bytes: blankLine,
    expect: {
      encoding: 'utf-8', bom: false, delimiter: ',', delimiterSource: 'default', terminator: '\n',
      trailingTerminator: true, otherTerminatorRecords: 0,
      header: ['a'], columnNames: ['a'], rows: [['1'], [''], ['2']],
      raggedCount: 0, raggedFirst: [], warningCodes: ['delimiter_defaulted'], reserializesExactly: true,
    },
  },
  {
    name: 'header only, no terminator',
    bytes: headerOnly,
    expect: {
      encoding: 'utf-8', bom: false, delimiter: ',', delimiterSource: 'detected', terminator: '\n',
      trailingTerminator: false, otherTerminatorRecords: 0,
      header: ['a', 'b'], columnNames: ['a', 'b'], rows: [],
      raggedCount: 0, raggedFirst: [], warningCodes: NONE, reserializesExactly: true,
    },
  },
  {
    name: 'malformed: quote inside an unquoted field',
    bytes: quoteInUnquotedField,
    expect: {
      encoding: 'utf-8', bom: false, delimiter: ',', delimiterSource: 'detected', terminator: '\n',
      trailingTerminator: true, otherTerminatorRecords: 0,
      header: ['a', 'b'], columnNames: ['a', 'b'], rows: [['1', 'x"y']],
      raggedCount: 0, raggedFirst: [], warningCodes: ['malformed_quotes'], reserializesExactly: false,
    },
  },
  {
    name: 'malformed: text after a quote inside a quoted field',
    bytes: textAfterInnerQuote,
    expect: {
      encoding: 'utf-8', bom: false, delimiter: ',', delimiterSource: 'detected', terminator: '\n',
      trailingTerminator: true, otherTerminatorRecords: 0,
      header: ['a', 'b'], columnNames: ['a', 'b'], rows: [['x"y', 'z']],
      raggedCount: 0, raggedFirst: [], warningCodes: ['malformed_quotes'], reserializesExactly: false,
    },
  },
  {
    name: 'malformed: unclosed quote',
    bytes: unclosedQuote,
    expect: {
      encoding: 'utf-8', bom: false, delimiter: ',', delimiterSource: 'detected', terminator: '\n',
      trailingTerminator: false, otherTerminatorRecords: 0,
      header: ['a', 'b'], columnNames: ['a', 'b'], rows: [['1', 'x\n2,y\n']],
      raggedCount: 0, raggedFirst: [], warningCodes: ['malformed_quotes'], reserializesExactly: false,
    },
  },
];

/**
 * CSV/TSV parsing (spec item 1, C §1 item 1 and §2.4, PLAN.md M1 AC3 and row 12). Pure; browser- and Node-safe.
 *
 * Pipeline for decoded text:
 *  1. Delimiter detection over a bounded sample (first DELIMITER_SAMPLE_CHARS characters, at most
 *     DELIMITER_SAMPLE_RECORDS records), candidates `, ; \t |`, quote-aware. Highest count of records sharing the
 *     modal field count (> 1) wins; ties -> larger modal count -> candidate order. None found -> ',' (one column).
 *  2. A quote-aware structural scan of the whole text with that delimiter: record terminators outside quotes
 *     (CRLF / LF / CR), trailing terminator, field counts. The record and column caps are enforced here first
 *     (early stop at the record cap), so an over-cap file is rejected without building rows.
 *  3. Terminator: the majority kind (ties -> CRLF, LF, CR). A mixed-terminator file is normalised to the majority
 *     terminator outside quoted fields (embedded line breaks inside quotes are cell content and never touched);
 *     the count of records with another terminator is reported. Export uses the majority (PLAN.md row 12).
 *  4. papaparse with the explicit delimiter and terminator, `dynamicTyping: false`, no header mode, no empty-line
 *     skipping. Its `step` callback re-checks both caps (backstop) and collects rows at their actual width.
 *  5. First record = header. ColumnIds c0..c(n-1) where n = max(header width, widest record); positions beyond the
 *     header get an empty name. Records are never padded; ragged = width != header width (count + first 5).
 */

import Papa from 'papaparse';
import {
  DEFAULT_DELIMITER,
  DEFAULT_TERMINATOR,
  DELIMITERS,
  DELIMITER_SAMPLE_CHARS,
  DELIMITER_SAMPLE_RECORDS,
  MAX_COLUMNS,
  MAX_RECORDS,
  RAGGED_LOCATIONS_REPORTED,
  TERMINATORS,
  type Delimiter,
  type Encoding,
  type Terminator,
} from '../constants.ts';
import { columnIdAt, type Column, type Table } from '../table.ts';
import { decode, formatCount, type Decoded, type InputError, type InputWarning } from './decode.ts';

export interface RaggedLocation {
  readonly rid: number;
  readonly width: number;
}

export interface RaggedSummary {
  readonly count: number;
  /** First RAGGED_LOCATIONS_REPORTED ragged records in file order. */
  readonly first: readonly RaggedLocation[];
}

export interface TerminatorCounts {
  readonly crlf: number;
  readonly lf: number;
  readonly cr: number;
}

/** File metadata. Not part of the table hash (C §2.4); recorded in the journal genesis event. */
export interface ParseMeta {
  readonly encoding: Encoding;
  readonly bom: boolean;
  readonly byte_length: number;
  readonly delimiter: Delimiter;
  readonly delimiter_source: 'detected' | 'default' | 'user';
  /** Majority record terminator; used for export. */
  readonly terminator: Terminator;
  readonly terminator_counts: TerminatorCounts;
  /** Records whose terminator differs from the majority (normalised on export). */
  readonly other_terminator_records: number;
  /** The text ended with a record terminator (re-emitted on export). */
  readonly trailing_terminator: boolean;
  /** Data records, excluding the header. */
  readonly records: number;
  readonly columns: number;
  readonly header_width: number;
  readonly ragged: RaggedSummary;
  readonly warnings: readonly InputWarning[];
}

export interface ParseOptions {
  /** Skip detection and use this delimiter (user override). */
  readonly delimiter?: Delimiter;
}

export type ParseResult =
  | { readonly ok: true; readonly table: Table; readonly meta: ParseMeta }
  | { readonly ok: false; readonly error: InputError };

const QUOTE = 0x22;
const CR = 0x0d;
const LF = 0x0a;

/** Index into TERMINATORS. */
const KIND_CRLF = 0;
const KIND_LF = 1;
const KIND_CR = 2;

interface WalkResult {
  /** Field count of each terminated record. */
  readonly fieldCounts: number[];
  /** Terminator kind (index into TERMINATORS) of each terminated record. */
  readonly termKinds: number[];
  /** Character offset of each terminator. */
  readonly termPositions: number[];
  /** Field count of a final record that has no terminator; null if none (or if the walk stopped early). */
  readonly partialFields: number | null;
  readonly malformedQuotes: number;
  readonly stoppedEarly: boolean;
}

/**
 * Quote-aware structural walk, aligned with papaparse's quote rule so the scanner and the parser agree on record
 * boundaries for malformed input too:
 *  - a quote opens a quoted field only at field start; a quote anywhere else in an unquoted field is literal
 *    content (counted as malformed; papaparse keeps it silently);
 *  - inside quotes, `""` is an escaped quote (RFC 4180);
 *  - inside quotes, a single `"` CLOSES the field only when it is followed by the delimiter, CR, LF or the end of
 *    the scanned text; otherwise it is a literal quote inside the field (counted as malformed; papaparse reports
 *    InvalidQuotes and keeps searching), and the field stays open;
 *  - delimiters and line breaks inside quotes are content; an unclosed quote runs to the end (counted).
 * Known difference: papaparse also accepts spaces between a closing quote and the delimiter/newline (`"x" ,y`);
 * this walk does not, so such a file reports record_count_mismatch (docs/DEFERRED-VALIDATION.md).
 */
function walk(text: string, delimiter: Delimiter, maxChars: number, maxRecords: number): WalkResult {
  const delim = delimiter.charCodeAt(0);
  const end = Math.min(text.length, maxChars);
  const fieldCounts: number[] = [];
  const termKinds: number[] = [];
  const termPositions: number[] = [];
  let fields = 1;
  let fieldStart = true;
  let inQuotes = false;
  let consumed = false;
  let malformedQuotes = 0;
  let stoppedEarly = false;
  let i = 0;

  while (i < end) {
    const ch = text.charCodeAt(i);
    if (inQuotes) {
      if (ch === QUOTE) {
        if (i + 1 < end && text.charCodeAt(i + 1) === QUOTE) {
          i += 2;
          continue;
        }
        const next = i + 1 < end ? text.charCodeAt(i + 1) : -1;
        if (next === -1 || next === delim || next === CR || next === LF) {
          inQuotes = false;
        } else {
          malformedQuotes += 1;
        }
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === delim) {
      fields += 1;
      fieldStart = true;
      consumed = true;
      i += 1;
      continue;
    }
    if (ch === CR || ch === LF) {
      const crlf = ch === CR && i + 1 < end && text.charCodeAt(i + 1) === LF;
      fieldCounts.push(fields);
      termKinds.push(crlf ? KIND_CRLF : ch === CR ? KIND_CR : KIND_LF);
      termPositions.push(i);
      i += crlf ? 2 : 1;
      fields = 1;
      fieldStart = true;
      consumed = false;
      if (fieldCounts.length >= maxRecords) {
        stoppedEarly = true;
        break;
      }
      continue;
    }
    if (ch === QUOTE) {
      if (fieldStart) {
        inQuotes = true;
        fieldStart = false;
        consumed = true;
        i += 1;
        continue;
      }
      malformedQuotes += 1;
    }
    fieldStart = false;
    consumed = true;
    i += 1;
  }

  if (inQuotes && !stoppedEarly && end === text.length) malformedQuotes += 1;
  const walkedAll = !stoppedEarly && end === text.length;
  return {
    fieldCounts,
    termKinds,
    termPositions,
    partialFields: walkedAll && consumed ? fields : null,
    malformedQuotes,
    stoppedEarly,
  };
}

/** Bounded-sample delimiter detection (exported for tests and the UI's "detected delimiter" line). */
export function detectDelimiter(text: string): { readonly delimiter: Delimiter; readonly detected: boolean } {
  let best: { delimiter: Delimiter; support: number; modal: number } | null = null;
  for (const candidate of DELIMITERS) {
    const scan = walk(text, candidate, DELIMITER_SAMPLE_CHARS, DELIMITER_SAMPLE_RECORDS);
    const counts = scan.partialFields === null ? scan.fieldCounts : [...scan.fieldCounts, scan.partialFields];
    const frequency = new Map<number, number>();
    for (const count of counts) {
      if (count > 1) frequency.set(count, (frequency.get(count) ?? 0) + 1);
    }
    let modal = 0;
    let support = 0;
    for (const [count, times] of frequency) {
      if (times > support || (times === support && count > modal)) {
        modal = count;
        support = times;
      }
    }
    if (support === 0) continue;
    if (best === null || support > best.support || (support === best.support && modal > best.modal)) {
      best = { delimiter: candidate, support, modal };
    }
  }
  return best === null ? { delimiter: DEFAULT_DELIMITER, detected: false } : { delimiter: best.delimiter, detected: true };
}

export function terminatorName(terminator: Terminator): 'CRLF' | 'LF' | 'CR' {
  return terminator === '\r\n' ? 'CRLF' : terminator === '\n' ? 'LF' : 'CR';
}

function recordsCapError(): InputError {
  return {
    code: 'cap_records',
    message: `File has more than ${formatCount(MAX_RECORDS)} data records (excluding the header); the limit is ${formatCount(MAX_RECORDS)}.`,
    cap: { name: 'MAX_RECORDS', limit: MAX_RECORDS },
  };
}

function columnsCapError(recordIndex: number, width: number): InputError {
  const where = recordIndex === 0 ? 'The header record' : `Data record ${formatCount(recordIndex - 1)} (0-based)`;
  return {
    code: 'cap_columns',
    message: `${where} has ${formatCount(width)} fields; the limit is ${MAX_COLUMNS} columns.`,
    cap: { name: 'MAX_COLUMNS', limit: MAX_COLUMNS },
  };
}

/** Parse decoded text into a Table plus file metadata. Never throws for bad input. */
export function parseText(decoded: Decoded, options: ParseOptions = {}): ParseResult {
  const { text } = decoded;
  if (text.length === 0) {
    return { ok: false, error: { code: 'empty_file', message: 'File contains no data.' } };
  }
  const warnings: InputWarning[] = [...decoded.warnings];

  // 1. Delimiter.
  let delimiter: Delimiter;
  let delimiterSource: ParseMeta['delimiter_source'];
  if (options.delimiter !== undefined) {
    delimiter = options.delimiter;
    delimiterSource = 'user';
  } else {
    const detection = detectDelimiter(text);
    delimiter = detection.delimiter;
    delimiterSource = detection.detected ? 'detected' : 'default';
    if (!detection.detected) {
      warnings.push({
        code: 'delimiter_defaulted',
        message: 'No delimiter (, ; tab |) found in the sample; the file is read as a single column.',
      });
    }
  }

  // 2. Structural scan with early cap enforcement. +2 = header + cap + one more record proves the overflow.
  const scan = walk(text, delimiter, Number.POSITIVE_INFINITY, MAX_RECORDS + 2);
  const totalRecords = scan.fieldCounts.length + (scan.partialFields === null ? 0 : 1);
  if (scan.stoppedEarly || totalRecords > MAX_RECORDS + 1) {
    return { ok: false, error: recordsCapError() };
  }
  const allCounts = scan.partialFields === null ? scan.fieldCounts : [...scan.fieldCounts, scan.partialFields];
  for (let index = 0; index < allCounts.length; index += 1) {
    if (allCounts[index] > MAX_COLUMNS) return { ok: false, error: columnsCapError(index, allCounts[index]) };
  }

  // 3. Terminator: majority, normalise the minority outside quotes.
  const kindCounts = [0, 0, 0];
  for (const kind of scan.termKinds) kindCounts[kind] += 1;
  let majorityKind = -1;
  for (let kind = 0; kind < TERMINATORS.length; kind += 1) {
    if (kindCounts[kind] > 0 && (majorityKind === -1 || kindCounts[kind] > kindCounts[majorityKind])) majorityKind = kind;
  }
  const terminator: Terminator = majorityKind === -1 ? DEFAULT_TERMINATOR : TERMINATORS[majorityKind];
  const otherTerminatorRecords = majorityKind === -1 ? 0 : scan.termKinds.length - kindCounts[majorityKind];
  let normalised = text;
  if (otherTerminatorRecords > 0) {
    const pieces: string[] = [];
    let last = 0;
    for (let k = 0; k < scan.termKinds.length; k += 1) {
      const kind = scan.termKinds[k];
      if (kind === majorityKind) continue;
      const position = scan.termPositions[k];
      pieces.push(text.slice(last, position), terminator);
      last = position + TERMINATORS[kind].length;
    }
    pieces.push(text.slice(last));
    normalised = pieces.join('');
    warnings.push({
      code: 'mixed_terminators',
      message: `${formatCount(otherTerminatorRecords)} record(s) end with a different line ending than the majority (${terminatorName(terminator)}); export uses ${terminatorName(terminator)} throughout.`,
    });
  }
  const trailingTerminator = scan.termKinds.length > 0 && scan.partialFields === null;
  // Strip the final terminator so papaparse does not emit a phantom empty record after it.
  const body = trailingTerminator ? normalised.slice(0, normalised.length - terminator.length) : normalised;

  // 4. papaparse with explicit settings; caps re-checked per record (backstop).
  const rows: string[][] = [];
  const state: { capError: InputError | null; parserErrors: number } = { capError: null, parserErrors: 0 };
  if (body.length > 0) {
    Papa.parse<string[]>(body, {
      delimiter,
      newline: terminator,
      quoteChar: '"',
      escapeChar: '"',
      header: false,
      dynamicTyping: false,
      skipEmptyLines: false,
      step: (results, parser) => {
        state.parserErrors += results.errors.length;
        const record = results.data;
        if (record.length > MAX_COLUMNS) {
          state.capError = columnsCapError(rows.length, record.length);
          parser.abort();
          return;
        }
        if (rows.length >= MAX_RECORDS + 1) {
          state.capError = recordsCapError();
          parser.abort();
          return;
        }
        rows.push(record.map((cell) => String(cell)));
      },
    });
  }
  if (state.capError !== null) return { ok: false, error: state.capError };
  // The body was a lone terminator (e.g. "\n"): one empty header record.
  if (rows.length === 0) rows.push(['']);

  if (state.parserErrors > 0 || scan.malformedQuotes > 0) {
    warnings.push({
      code: 'malformed_quotes',
      message: `Found ${formatCount(Math.max(state.parserErrors, scan.malformedQuotes))} quoting problem(s) (a quote inside an unquoted field, text after a closing quote, or an unclosed quote). Check the affected records.`,
    });
  }
  if (rows.length !== Math.max(totalRecords, 1)) {
    warnings.push({
      code: 'record_count_mismatch',
      message: `The structural scan found ${formatCount(totalRecords)} record(s) but the parser produced ${formatCount(rows.length)}; malformed quoting is the likely cause.`,
    });
  }

  // 5. Table.
  const header = rows[0];
  const data = rows.slice(1);
  const headerWidth = header.length;
  let width = headerWidth;
  for (const record of data) if (record.length > width) width = record.length;
  const cols: Column[] = [];
  for (let c = 0; c < width; c += 1) cols.push({ id: columnIdAt(c), name: c < headerWidth ? header[c] : '' });

  const raggedFirst: RaggedLocation[] = [];
  let raggedCount = 0;
  data.forEach((record, rid) => {
    if (record.length !== headerWidth) {
      raggedCount += 1;
      if (raggedFirst.length < RAGGED_LOCATIONS_REPORTED) raggedFirst.push({ rid, width: record.length });
    }
  });

  const table: Table = { cols, rows: data, rid: data.map((_, rid) => rid) };
  const meta: ParseMeta = {
    encoding: decoded.encoding,
    bom: decoded.bom,
    byte_length: decoded.byteLength,
    delimiter,
    delimiter_source: delimiterSource,
    terminator,
    terminator_counts: { crlf: kindCounts[KIND_CRLF], lf: kindCounts[KIND_LF], cr: kindCounts[KIND_CR] },
    other_terminator_records: otherTerminatorRecords,
    trailing_terminator: trailingTerminator,
    records: data.length,
    columns: width,
    header_width: headerWidth,
    ragged: { count: raggedCount, first: raggedFirst },
    warnings,
  };
  return { ok: true, table, meta };
}

/** decode + parseText: the browser entry point for a dropped file's bytes. */
export function parseBytes(input: Uint8Array | ArrayBuffer, options: ParseOptions = {}): ParseResult {
  const decoded = decode(input);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  return parseText(decoded.value, options);
}

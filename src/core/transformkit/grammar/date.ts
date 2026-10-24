/**
 * Date grammar for standardize_date (C §2.6 with PLAN.md row 3 and §8 item 6; PLAN.md M2 AC3). Pure.
 *
 * Contract:
 *  - The stated `from_format` (one of the 12 numeric DATE_FORMATS) is TOKENISED into YYYY / YY / MM / DD and
 *    separator tokens; a cell is matched token by token and must be consumed completely. There is no per-cell
 *    format guessing, no substring search inside cells and no trimming.
 *  - Separated formats: YYYY = exactly 4 digits, YY = exactly 2, MM and DD = 1 or 2 digits, separators exact.
 *    Compact YYYYMMDD: exactly 8 digits (4 + 2 + 2).
 *  - Gregorian validation: month 1..12, day 1..days-in-month with leap years (divisible by 4, except centuries
 *    not divisible by 400); year 0000 is rejected. "31/02/2023" is a miss.
 *  - Two-digit years use the POSIX pivot: YY >= 69 -> 19YY, YY <= 68 -> 20YY.
 *  - Output is always YYYY-MM-DD.
 *  - `swapDayMonth` gives the DD<->MM twin of a day/month format (for the date_order guard).
 */

import { DATE_FORMATS, TWO_DIGIT_YEAR_PIVOT, type DateFormat } from '../../constants.ts';

export type DateToken =
  | { readonly kind: 'year4' }
  | { readonly kind: 'year2' }
  | { readonly kind: 'month' }
  | { readonly kind: 'day' }
  | { readonly kind: 'sep'; readonly char: string };

export interface DateMatch {
  readonly ok: true;
  readonly iso: string;
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface DateMiss {
  readonly ok: false;
  readonly reason: string;
}

export type DateParse = DateMatch | DateMiss;

const SEPARATORS = new Set(['-', '/', '.']);
const tokenCache = new Map<DateFormat, readonly DateToken[]>();

export function isDateFormat(value: unknown): value is DateFormat {
  return typeof value === 'string' && (DATE_FORMATS as readonly string[]).includes(value);
}

/** Tokenise a whitelisted format. Throws on anything outside the grammar (formats are code constants). */
export function tokenizeDateFormat(format: DateFormat): readonly DateToken[] {
  const cached = tokenCache.get(format);
  if (cached !== undefined) return cached;
  const tokens: DateToken[] = [];
  let i = 0;
  while (i < format.length) {
    if (format.startsWith('YYYY', i)) {
      tokens.push({ kind: 'year4' });
      i += 4;
    } else if (format.startsWith('YY', i)) {
      tokens.push({ kind: 'year2' });
      i += 2;
    } else if (format.startsWith('MM', i)) {
      tokens.push({ kind: 'month' });
      i += 2;
    } else if (format.startsWith('DD', i)) {
      tokens.push({ kind: 'day' });
      i += 2;
    } else if (SEPARATORS.has(format[i])) {
      tokens.push({ kind: 'sep', char: format[i] });
      i += 1;
    } else {
      throw new Error(`date format ${format} has an unsupported character at ${i}`);
    }
  }
  const frozen = Object.freeze(tokens);
  tokenCache.set(format, frozen);
  return frozen;
}

export function hasTwoDigitYear(format: DateFormat): boolean {
  return tokenizeDateFormat(format).some((t) => t.kind === 'year2');
}

/** True for the DD/MM and MM/DD families (a day and a month token, year last); never for YYYY-first formats. */
export function isDayMonthFormat(format: DateFormat): boolean {
  const tokens = tokenizeDateFormat(format);
  const numeric = tokens.filter((t) => t.kind !== 'sep');
  return numeric.length === 3 && (numeric[0].kind === 'day' || numeric[0].kind === 'month');
}

function formatOf(tokens: readonly DateToken[]): string {
  return tokens
    .map((t) => {
      switch (t.kind) {
        case 'year4':
          return 'YYYY';
        case 'year2':
          return 'YY';
        case 'month':
          return 'MM';
        case 'day':
          return 'DD';
        case 'sep':
          return t.char;
      }
    })
    .join('');
}

/** DD/MM/YYYY <-> MM/DD/YYYY etc. Null for formats without that twin (YYYY-first formats). */
export function swapDayMonth(format: DateFormat): DateFormat | null {
  if (!isDayMonthFormat(format)) return null;
  const swapped = formatOf(
    tokenizeDateFormat(format).map((t): DateToken => {
      if (t.kind === 'day') return { kind: 'month' };
      if (t.kind === 'month') return { kind: 'day' };
      return t;
    }),
  );
  return isDateFormat(swapped) ? swapped : null;
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
}

function digitAt(text: string, i: number): number {
  const code = text.charCodeAt(i);
  return code >= 48 && code <= 57 ? code - 48 : -1;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Parse one cell under the stated format. Never throws. */
export function parseDateCell(value: string, format: DateFormat): DateParse {
  if (value.length === 0) return { ok: false, reason: 'empty' };
  const tokens = tokenizeDateFormat(format);
  const compact = !tokens.some((t) => t.kind === 'sep');
  let pos = 0;
  let year = -1;
  let month = -1;
  let day = -1;

  for (const token of tokens) {
    if (token.kind === 'sep') {
      if (value[pos] !== token.char) return { ok: false, reason: `expected "${token.char}" at ${pos}` };
      pos += 1;
      continue;
    }
    let min: number;
    let max: number;
    if (token.kind === 'year4') {
      min = 4;
      max = 4;
    } else if (token.kind === 'year2') {
      min = 2;
      max = 2;
    } else {
      min = compact ? 2 : 1;
      max = 2;
    }
    let n = 0;
    let digits = 0;
    while (digits < max && pos < value.length) {
      const d = digitAt(value, pos);
      if (d < 0) break;
      n = n * 10 + d;
      digits += 1;
      pos += 1;
    }
    if (digits < min) return { ok: false, reason: `expected ${min}-${max} digits at ${pos}` };
    // In separated formats a digit run must end at a separator or the end of the cell (no 3-digit day).
    if (!compact && pos < value.length && digitAt(value, pos) >= 0) {
      return { ok: false, reason: `too many digits at ${pos}` };
    }
    if (token.kind === 'year4') year = n;
    else if (token.kind === 'year2') year = n >= TWO_DIGIT_YEAR_PIVOT ? 1900 + n : 2000 + n;
    else if (token.kind === 'month') month = n;
    else day = n;
  }
  if (pos !== value.length) return { ok: false, reason: 'trailing characters' };
  if (year < 1 || year > 9999) return { ok: false, reason: 'year out of range' };
  if (month < 1 || month > 12) return { ok: false, reason: 'month out of range' };
  if (day < 1 || day > daysInMonth(year, month)) return { ok: false, reason: 'day out of range for the month' };
  return { ok: true, iso: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`, year, month, day };
}

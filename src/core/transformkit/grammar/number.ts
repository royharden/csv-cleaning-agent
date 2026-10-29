/**
 * Number grammar for parse_number (C §2.6, PLAN.md M2 AC2). Pure. STRING OPERATIONS ONLY: this module never
 * converts text to a JavaScript number (no numeric built-in conversion of any kind), so no value is rounded
 * and a 20-digit amount is preserved digit for digit. scripts/check-no-dynamic-code.ts enforces this.
 *
 * Grammar for one cell, given {decimal, thousands, currency[], parens_negative} (no implicit trimming: a padded
 * cell does not match; trim is its own op):
 *
 *   cell     := "(" body ")"            only when parens_negative; the value is negative; no sign inside
 *             | sign? body
 *   body     := prefix? sign? number    the sign after a currency prefix is allowed only if none came before
 *             | number suffix?
 *   prefix   := MARKER " "?             MARKER is one of the step's `currency` list (at most one marker per cell)
 *   suffix   := " "? MARKER
 *   sign     := "-" | U+2212
 *   number   := integer (DECIMAL digit+)?
 *   integer  := digit+                                 (ungrouped)
 *             | digit{1,3} (THOUSANDS digit{3})+       (grouped; only when thousands != "none")
 *   digit    := ASCII 0-9
 *
 * Rejected (left unchanged, counted unparsed): exponent, hex, Infinity/NaN words, doubled or trailing signs, "+",
 * malformed grouping, a missing integer part (".5"), an empty fraction ("12."), percentages ("12%"), more than
 * one currency marker, surrounding spaces.
 *
 * Canonical output: "-"? integer-digits ("." fraction-digits)?, with leading zeros of the integer part removed
 * (one "0" kept) and the fraction kept exactly as written (no rounding, trailing zeros kept). The sign is kept
 * as written, so "-0" stays "-0".
 */

import {
  CURRENCY_MARKERS,
  MINUS_SIGNS,
  THOUSANDS_GROUP_SIZE,
  type CurrencyMarker,
  type DecimalSeparator,
  type ThousandsSeparator,
} from '../../constants.ts';

export interface NumberGrammar {
  readonly decimal: DecimalSeparator;
  readonly thousands: ThousandsSeparator;
  readonly currency: readonly CurrencyMarker[];
  readonly parens_negative: boolean;
}

export interface NumberMatch {
  readonly ok: true;
  /** Canonical `-?digits(.digits)?`. */
  readonly canonical: string;
  readonly negative: boolean;
  /** Integer part exactly as written, separators included (e.g. "1,234" or "007"). */
  readonly integer_text: string;
  /** Fraction digits as written, or null when there is no decimal separator. */
  readonly fraction: string | null;
  /** The integer part used the thousands separator. */
  readonly grouped: boolean;
  readonly currency: CurrencyMarker | null;
}

export interface NumberMiss {
  readonly ok: false;
  readonly reason: string;
}

export type NumberParse = NumberMatch | NumberMiss;

/** All markers, longest first, so "USD" is tried before "$"-style single characters. */
const MARKERS_LONGEST_FIRST: readonly CurrencyMarker[] = [...CURRENCY_MARKERS].sort((a, b) => b.length - a.length);

function miss(reason: string): NumberMiss {
  return { ok: false, reason };
}

export function isAsciiDigits(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function isMinus(ch: string): boolean {
  return (MINUS_SIGNS as readonly string[]).includes(ch);
}

/** Integer part: ungrouped digits, or exact 3-digit groups. Returns the bare digits or null. */
function integerDigits(text: string, thousands: ThousandsSeparator): { digits: string; grouped: boolean } | null {
  if (isAsciiDigits(text)) return { digits: text, grouped: false };
  if (thousands === 'none') return null;
  const groups = text.split(thousands);
  if (groups.length < 2) return null;
  const first = groups[0];
  if (!isAsciiDigits(first) || first.length > THOUSANDS_GROUP_SIZE) return null;
  for (let g = 1; g < groups.length; g += 1) {
    if (groups[g].length !== THOUSANDS_GROUP_SIZE || !isAsciiDigits(groups[g])) return null;
  }
  return { digits: groups.join(''), grouped: true };
}

function stripLeadingZeros(digits: string): string {
  let i = 0;
  while (i < digits.length - 1 && digits[i] === '0') i += 1;
  return digits.slice(i);
}

/** Parse one cell under the stated grammar. Never throws. */
export function parseNumberCell(value: string, grammar: NumberGrammar): NumberParse {
  if (value.length === 0) return miss('empty');
  let s = value;
  let negative = false;
  let signSeen = false;

  if (grammar.parens_negative && s.length >= 2 && s[0] === '(' && s[s.length - 1] === ')') {
    s = s.slice(1, -1);
    negative = true;
    signSeen = true; // no sign allowed inside parentheses
  } else if (s.length > 0 && isMinus(s[0])) {
    s = s.slice(1);
    negative = true;
    signSeen = true;
  }

  // At most one currency marker, as prefix or suffix (only markers the step allows).
  let currency: CurrencyMarker | null = null;
  let prefixed = false;
  for (const marker of MARKERS_LONGEST_FIRST) {
    if (!grammar.currency.includes(marker)) continue;
    if (s.startsWith(marker)) {
      s = s.slice(marker.length);
      if (s.startsWith(' ')) s = s.slice(1);
      currency = marker;
      prefixed = true;
      break;
    }
  }
  if (currency === null) {
    for (const marker of MARKERS_LONGEST_FIRST) {
      if (!grammar.currency.includes(marker)) continue;
      if (s.endsWith(marker)) {
        s = s.slice(0, s.length - marker.length);
        if (s.endsWith(' ')) s = s.slice(0, -1);
        currency = marker;
        break;
      }
    }
  }
  if (prefixed && !signSeen && s.length > 0 && isMinus(s[0])) {
    s = s.slice(1);
    negative = true;
  }
  if (s.length === 0) return miss('no digits');

  // Split off the fraction at the (single) decimal separator.
  const firstDecimal = s.indexOf(grammar.decimal);
  if (firstDecimal !== s.lastIndexOf(grammar.decimal)) return miss('more than one decimal separator');
  const integerText = firstDecimal < 0 ? s : s.slice(0, firstDecimal);
  const fraction = firstDecimal < 0 ? null : s.slice(firstDecimal + 1);
  if (fraction !== null && !isAsciiDigits(fraction)) return miss('fraction is not digits');
  if (integerText.length === 0) return miss('missing integer part');
  const integer = integerDigits(integerText, grammar.thousands);
  if (integer === null) return miss('integer part does not match the grouping');

  const canonical = `${negative ? '-' : ''}${stripLeadingZeros(integer.digits)}${fraction === null ? '' : `.${fraction}`}`;
  return {
    ok: true,
    canonical,
    negative,
    integer_text: integerText,
    fraction,
    grouped: integer.grouped,
    currency,
  };
}

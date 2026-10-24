/**
 * Character-shape classes (spec item 2 "character-shape histogram"; C §2.7 null_shape_majority). Pure.
 *
 * Contract: a shape replaces every character by its class, so a shape never contains a letter or digit of the
 * data:
 *   uppercase letter -> "A"    lowercase letter -> "a"    other letter (no case) -> "L"
 *   decimal digit    -> "9"    any whitespace   -> " "
 *   one of SAFE_PUNCTUATION -> itself                      anything else -> "*"
 * `shapeOf` is exact (one class per code point; used by the null_shape_majority guard: "NA" -> "AA").
 * `collapsedShape` merges runs of the same class ("New York" -> "Aa Aa") and is clipped to 40 code points; it is
 * what the histograms (local and outbound) use. Because "<", "{", "[" and "\" map to "*", a shape can never form
 * instruction-like markup.
 */

import { OUTBOUND_VALUE_MAX_CHARS } from '../constants.ts';

export const SAFE_PUNCTUATION: ReadonlySet<string> = new Set([
  '-', '_', '.', ',', ':', ';', '/', '(', ')', '#', '@', '+', '%', '&', "'", '"', '!', '?', '$', '=',
]);

const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;
const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;
const SPACE = /\s/u;

export function charClass(ch: string): string {
  if (UPPER.test(ch)) return 'A';
  if (LOWER.test(ch)) return 'a';
  if (LETTER.test(ch)) return 'L';
  if (DIGIT.test(ch)) return '9';
  if (SPACE.test(ch)) return ' ';
  return SAFE_PUNCTUATION.has(ch) ? ch : '*';
}

export function shapeOf(value: string): string {
  let out = '';
  for (const ch of value) out += charClass(ch);
  return out;
}

export function collapsedShape(value: string, maxChars: number = OUTBOUND_VALUE_MAX_CHARS): string {
  let out = '';
  let last = '';
  let length = 0;
  for (const ch of value) {
    const cls = charClass(ch);
    if (cls === last) continue;
    last = cls;
    if (length >= maxChars) break;
    out += cls;
    length += 1;
  }
  return out;
}

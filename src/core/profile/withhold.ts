/**
 * Instruction-like screening for outbound text (C §1 item 2, §2.6; PLAN.md M2 AC7). Pure.
 *
 * Contract:
 *  - `isInstructionLike(value)` tests the COMPLETE original string against the static WITHHOLD_PATTERNS
 *    (case-insensitive literals in constants.ts) and WITHHOLD_LINE_BREAK. No pattern is ever built from data,
 *    plan params or model output.
 *  - `screenForOutbound(value, max)` screens first and clips second, so instruction text that starts after the
 *    clip point is still withheld. Clipping counts code points (never splits a surrogate pair). Withheld values
 *    become WITHHELD_PLACEHOLDER; clipped values are marked `truncated` (they are not exact observed values).
 *  - False positives only hide text from a model; callers count them so the UI can say how many were withheld.
 */

import { OUTBOUND_VALUE_MAX_CHARS, WITHHELD_PLACEHOLDER, WITHHOLD_LINE_BREAK, WITHHOLD_PATTERNS } from '../constants.ts';

export interface ScreenedText {
  readonly text: string;
  readonly withheld: boolean;
  readonly truncated: boolean;
}

export function isInstructionLike(value: string): boolean {
  if (WITHHOLD_LINE_BREAK.test(value)) return true;
  return WITHHOLD_PATTERNS.some((pattern) => pattern.test(value));
}

/** First `max` code points of `value`. */
export function clipCodePoints(value: string, max: number): { readonly text: string; readonly truncated: boolean } {
  let count = 0;
  let end = 0;
  for (const ch of value) {
    if (count === max) return { text: value.slice(0, end), truncated: true };
    count += 1;
    end += ch.length;
  }
  return { text: value, truncated: false };
}

export function screenForOutbound(value: string, max: number = OUTBOUND_VALUE_MAX_CHARS): ScreenedText {
  if (isInstructionLike(value)) return { text: WITHHELD_PLACEHOLDER, withheld: true, truncated: false };
  const clipped = clipCodePoints(value, max);
  return { text: clipped.text, withheld: false, truncated: clipped.truncated };
}

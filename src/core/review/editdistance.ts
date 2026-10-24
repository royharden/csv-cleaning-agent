/**
 * Exact edit distance for review cards (spec item 6 "3 largest exact edit-distance changes"; PLAN.md M2 AC8;
 * C §2.2). Pure.
 *
 * Contract:
 *  - `levenshtein(a, b)` is the exact Levenshtein distance over Unicode CODE POINTS (insert, delete, substitute,
 *    each cost 1), computed with a two-row dynamic programme in O(min(n, m)) memory. No approximation, no cap.
 *  - `largestEdits(changes, limit)` returns the `limit` changed cells with the largest distance; ties are broken
 *    deterministically by (rid ascending, column ordinal ascending). An upper bound (max length) skips cells that
 *    cannot enter the top list, without changing the result. Cost at the 20,000 x 60 cap is a deferred check.
 */

import { REVIEW_LARGEST_EDITS } from '../constants.ts';
import type { ColumnId } from '../table.ts';
import type { CellChanges } from '../transformkit/registry.ts';

export interface LargestEdit {
  readonly rid: number;
  readonly col: ColumnId;
  readonly old: string;
  readonly new: string;
  readonly distance: number;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let s = Array.from(a);
  let t = Array.from(b);
  if (s.length < t.length) {
    const swap = s;
    s = t;
    t = swap;
  }
  // t is the shorter sequence: rows of length t.length + 1.
  if (t.length === 0) return s.length;
  let previous = new Array<number>(t.length + 1);
  let current = new Array<number>(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) previous[j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    current[0] = i;
    const si = s[i - 1];
    for (let j = 1; j <= t.length; j += 1) {
      const substitution = previous[j - 1] + (si === t[j - 1] ? 0 : 1);
      const deletion = previous[j] + 1;
      const insertion = current[j - 1] + 1;
      let best = substitution;
      if (deletion < best) best = deletion;
      if (insertion < best) best = insertion;
      current[j] = best;
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[t.length];
}

/** Numeric ordinal of a ColumnId ("c12" -> 12) for deterministic ordering; non-ids sort last. */
export function columnOrdinal(id: ColumnId): number {
  if (id.length < 2 || id[0] !== 'c') return Number.MAX_SAFE_INTEGER;
  let value = 0;
  for (let i = 1; i < id.length; i += 1) {
    const digit = id.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) return Number.MAX_SAFE_INTEGER;
    value = value * 10 + digit;
  }
  return value;
}

/** a ranks before b: larger distance first, then smaller rid, then smaller column ordinal. */
function ranksBefore(a: LargestEdit, b: LargestEdit): boolean {
  if (a.distance !== b.distance) return a.distance > b.distance;
  if (a.rid !== b.rid) return a.rid < b.rid;
  return columnOrdinal(a.col) < columnOrdinal(b.col);
}

function codePointLength(value: string): number {
  let n = 0;
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    // A high surrogate followed by a low surrogate is one code point.
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i += 1;
    }
    n += 1;
  }
  return n;
}

export function largestEdits(changes: CellChanges, limit: number = REVIEW_LARGEST_EDITS): LargestEdit[] {
  const top: LargestEdit[] = [];
  if (limit <= 0) return top;
  for (let i = 0; i < changes.rid.length; i += 1) {
    const oldValue = changes.old[i];
    const newValue = changes.new[i];
    const upper = Math.max(codePointLength(oldValue), codePointLength(newValue));
    if (top.length === limit) {
      const last = top[top.length - 1];
      const bound: LargestEdit = { rid: changes.rid[i], col: changes.col[i], old: oldValue, new: newValue, distance: upper };
      if (!ranksBefore(bound, last)) continue;
    }
    const candidate: LargestEdit = {
      rid: changes.rid[i],
      col: changes.col[i],
      old: oldValue,
      new: newValue,
      distance: levenshtein(oldValue, newValue),
    };
    if (top.length === limit && !ranksBefore(candidate, top[top.length - 1])) continue;
    let at = top.length;
    while (at > 0 && ranksBefore(candidate, top[at - 1])) at -= 1;
    top.splice(at, 0, candidate);
    if (top.length > limit) top.pop();
  }
  return top;
}

/**
 * Guards (spec item 4; C §2.7 table; PLAN.md M2 AC5, §8 item 6). Pure.
 *
 *   evaluateGuards(predecessorTable, step, planContext) -> GuardHit[]
 *
 * Contract:
 *  - Input is an ACCEPTED step (validator.ts) and the table it would run on. A hit never rejects anything: it makes
 *    the step "valid but unconfirmed"; approval then needs one explicit confirmation per hit guard id (M3 binds it
 *    to the approval). At most one hit per guard id, ordered as GUARD_IDS.
 *  - Triggers (cells = present cells of the step's columns in the predecessor table):
 *    leading_zero_id     parse_number: a cell valid under the stated grammar whose number part (after sign and
 *                        currency) starts with "0" + digit, i.e. C's ^[+-]?0\d on the numeric text ("007").
 *    thousands_ambiguity parse_number: a cell matches ^\d{1,3}[.,]\d{3}$ and NO cell that is valid under the
 *                        complete stated grammar proves the convention (a valid cell with both the thousands and
 *                        the decimal separator, or a valid fraction whose length != 3); malformed cells never prove.
 *    date_order          standardize_date, DD/MM and MM/DD families only (never YYYY-first incl. YYYYMMDD): the
 *                        stated order is not proven by any cell (a cell valid under the stated format and invalid
 *                        under its day/month twin), or some cell proves the opposite order (contradictory).
 *    two_digit_year      standardize_date: the stated format has a YY token (DD/MM/YY, MM/DD/YY).
 *    null_shape_majority null_tokens: for a selected token and column, the token's exact shape (shapes.ts) equals
 *                        the shape of >= 50% of the column's non-empty cells
 *                        ("NA" in a column of two-letter country codes).
 *    title_on_mixed      normalize_case mode title: a cell has an uppercase letter right after a lowercase letter
 *                        within a word (McDonald, iPhone), or a lowercase particle word (TITLE_PARTICLES) followed
 *                        by a capitalised word ("van Gogh").
 *    category_target     map_categories: a `to` not observed in the predecessor column (only possible after a
 *                        local human edit), or one `to` absorbing > CATEGORY_TARGET_MAX_SOURCES distinct sources.
 *    dedup_before_trim   drop_duplicate_rows: a trim_whitespace step occurs later in the plan, or the predecessor
 *                        has more duplicate rows after trimming than exact duplicates and no earlier trim step is
 *                        in effect (planContext.applied[j] !== false).
 */

import {
  CATEGORY_TARGET_MAX_SOURCES,
  DAY_MONTH_ORDER_FORMATS,
  GUARD_IDS,
  NULL_SHAPE_MAJORITY_SHARE,
  TITLE_PARTICLES,
  type DateFormat,
  type GuardId,
} from '../constants.ts';
import { duplicateRowsAfterTrim, exactDuplicateRows } from '../profile/profile.ts';
import { shapeOf } from '../profile/shapes.ts';
import { columnIndexOf, type ColumnId, type Table } from '../table.ts';
import { hasTwoDigitYear, parseDateCell, swapDayMonth } from './grammar/date.ts';
import { parseNumberCell, type NumberGrammar } from './grammar/number.ts';
import { observedValues } from './ops/map_categories.ts';
import type { PlanStep } from './registry.ts';
import {
  MapCategoriesParams,
  NormalizeCaseParams,
  NullTokensParams,
  ParseNumberParams,
  StandardizeDateParams,
} from './schemas.ts';

export interface GuardHit {
  readonly guard: GuardId;
  readonly step_id: string;
  readonly columns: readonly ColumnId[];
  /** Plain-language reason shown on the card. */
  readonly message: string;
  readonly details: Readonly<Record<string, number | string>>;
}

export interface PlanContext {
  /** The whole plan as it stands (accepted steps, in plan order). */
  readonly steps: readonly PlanStep[];
  /** Position of `step` in `steps`. */
  readonly index: number;
  /** applied[j] === false: earlier step j is not in effect (rejected / not yet approved). Default: in effect. */
  readonly applied?: readonly boolean[];
  /** The step's current params come from a local human edit. */
  readonly humanEdited?: boolean;
}

const THOUSANDS_AMBIGUOUS = /^\d{1,3}[.,]\d{3}$/;
const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;
const PARTICLES: ReadonlySet<string> = new Set(TITLE_PARTICLES);

function presentCells(table: Table, ids: readonly ColumnId[]): { col: ColumnId; values: string[] }[] {
  return ids.map((id) => {
    const index = columnIndexOf(table, id);
    const values: string[] = [];
    if (index >= 0) for (const row of table.rows) if (index < row.length) values.push(row[index]);
    return { col: id, values };
  });
}

function hit(guard: GuardId, step: PlanStep, columns: readonly ColumnId[], message: string, details: Record<string, number | string>): GuardHit {
  return { guard, step_id: step.id, columns, message, details };
}

// --- parse_number ---------------------------------------------------------------------------------

function numberGuards(table: Table, step: PlanStep, grammar: NumberGrammar): GuardHit[] {
  const hits: GuardHit[] = [];
  const zeroCols: ColumnId[] = [];
  let zeroCells = 0;
  const ambiguousCols: ColumnId[] = [];
  let ambiguousCells = 0;
  for (const { col, values } of presentCells(table, step.columns)) {
    let zeros = 0;
    let ambiguous = 0;
    let proven = false;
    for (const value of values) {
      if (value === '') continue;
      const parsed = parseNumberCell(value, grammar);
      if (parsed.ok) {
        const t = parsed.integer_text;
        if (t.length >= 2 && t[0] === '0' && t.charCodeAt(1) >= 48 && t.charCodeAt(1) <= 57) zeros += 1;
        if (parsed.fraction !== null && (parsed.grouped || parsed.fraction.length !== 3)) proven = true;
      }
      if (THOUSANDS_AMBIGUOUS.test(value)) ambiguous += 1;
    }
    if (zeros > 0) {
      zeroCols.push(col);
      zeroCells += zeros;
    }
    if (ambiguous > 0 && !proven) {
      ambiguousCols.push(col);
      ambiguousCells += ambiguous;
    }
  }
  if (zeroCols.length > 0) {
    hits.push(
      hit('leading_zero_id', step, zeroCols, `${zeroCells} value(s) have leading zeros (IDs or codes?); parsing would remove them.`, {
        cells: zeroCells,
      }),
    );
  }
  if (ambiguousCols.length > 0) {
    hits.push(
      hit(
        'thousands_ambiguity',
        step,
        ambiguousCols,
        `${ambiguousCells} value(s) like "1,234" could be a thousands group or a decimal part, and no valid cell proves the convention.`,
        { cells: ambiguousCells, decimal: grammar.decimal, thousands: grammar.thousands },
      ),
    );
  }
  return hits;
}

// --- standardize_date -------------------------------------------------------------------------------

function dateGuards(table: Table, step: PlanStep, stated: DateFormat): GuardHit[] {
  const hits: GuardHit[] = [];
  if (DAY_MONTH_ORDER_FORMATS.includes(stated)) {
    const twin = swapDayMonth(stated);
    let provesStated = 0;
    let provesOther = 0;
    let ambiguous = 0;
    const columns: ColumnId[] = [];
    for (const { col, values } of presentCells(table, step.columns)) {
      let statedInColumn = 0;
      let otherInColumn = 0;
      let ambiguousInColumn = 0;
      for (const value of values) {
        if (value === '') continue;
        const a = parseDateCell(value, stated).ok;
        const b = twin === null ? false : parseDateCell(value, twin).ok;
        if (a && b) ambiguousInColumn += 1;
        else if (a) statedInColumn += 1;
        else if (b) otherInColumn += 1;
      }
      // Evidence in one column cannot establish the convention in another column.
      if (statedInColumn === 0 || otherInColumn > 0) columns.push(col);
      provesStated += statedInColumn;
      provesOther += otherInColumn;
      ambiguous += ambiguousInColumn;
    }
    if (columns.length > 0) {
      const message =
        provesOther > 0 && provesStated > 0
          ? `Contradictory: ${provesStated} cell(s) prove ${stated} but ${provesOther} prove ${twin ?? 'the other order'}; no single format fits.`
          : provesOther > 0
            ? `${provesOther} cell(s) prove ${twin ?? 'the other order'}, not the stated ${stated}.`
            : `Cannot prove day/month order in ${columns.join(', ')}: no cell there proves the stated order (${ambiguous} ambiguous cell(s) across the step).`;
      hits.push(
        hit('date_order', step, columns, message, {
          proves_stated: provesStated,
          proves_other: provesOther,
          ambiguous,
          stated,
          other: twin ?? '',
        }),
      );
    }
  }
  if (hasTwoDigitYear(stated)) {
    hits.push(
      hit('two_digit_year', step, step.columns, `${stated} has a two-digit year: 69-99 become 1969-1999, 00-68 become 2000-2068.`, {
        stated,
      }),
    );
  }
  return hits;
}

// --- null_tokens ----------------------------------------------------------------------------------

function nullGuards(table: Table, step: PlanStep, tokens: readonly string[]): GuardHit[] {
  const flagged: string[] = [];
  const cols: ColumnId[] = [];
  let worstShare = 0;
  for (const { col, values } of presentCells(table, step.columns)) {
    const nonEmpty = values.filter((v) => v !== '');
    if (nonEmpty.length === 0) continue;
    const shapeCounts = new Map<string, number>();
    for (const v of nonEmpty) {
      const s = shapeOf(v);
      shapeCounts.set(s, (shapeCounts.get(s) ?? 0) + 1);
    }
    let colHit = false;
    for (const token of tokens) {
      const share = (shapeCounts.get(shapeOf(token)) ?? 0) / nonEmpty.length;
      if (share >= NULL_SHAPE_MAJORITY_SHARE) {
        if (!flagged.includes(token)) flagged.push(token);
        if (share > worstShare) worstShare = share;
        colHit = true;
      }
    }
    if (colHit) cols.push(col);
  }
  if (flagged.length === 0) return [];
  const pct = Math.round(worstShare * 100);
  return [
    hit(
      'null_shape_majority',
      step,
      cols,
      `${flagged.map((t) => JSON.stringify(t)).join(', ')} looks like real values here (same shape as ${pct}% of non-empty cells), e.g. "NA" = Namibia.`,
      { tokens: flagged.join(' '), share_percent: pct },
    ),
  ];
}

// --- normalize_case (title) -------------------------------------------------------------------------

export function hasMixedCaseWord(value: string): boolean {
  const words = value.split(/\s+/).filter((w) => w.length > 0);
  for (let w = 0; w < words.length; w += 1) {
    const chars = Array.from(words[w]);
    for (let i = 1; i < chars.length; i += 1) {
      if (UPPER.test(chars[i]) && LOWER.test(chars[i - 1])) return true;
    }
    if (PARTICLES.has(words[w]) && w + 1 < words.length) {
      const next = Array.from(words[w + 1]);
      if (next.length > 0 && UPPER.test(next[0])) return true;
    }
  }
  return false;
}

function titleGuards(table: Table, step: PlanStep): GuardHit[] {
  let cells = 0;
  const cols: ColumnId[] = [];
  for (const { col, values } of presentCells(table, step.columns)) {
    const n = values.filter(hasMixedCaseWord).length;
    if (n > 0) {
      cols.push(col);
      cells += n;
    }
  }
  if (cells === 0) return [];
  return [
    hit('title_on_mixed', step, cols, `${cells} value(s) have deliberate mixed case (McDonald, iPhone, van Gogh); title case would flatten them.`, {
      cells,
    }),
  ];
}

// --- map_categories ---------------------------------------------------------------------------------

function categoryGuards(table: Table, step: PlanStep, groups: readonly { from: readonly string[]; to: string }[], humanEdited: boolean): GuardHit[] {
  const index = step.columns.length === 1 ? columnIndexOf(table, step.columns[0]) : -1;
  const observed = index >= 0 ? observedValues(table, index) : new Set<string>();
  const sourcesByTarget = new Map<string, Set<string>>();
  for (const group of groups) {
    const sources = sourcesByTarget.get(group.to) ?? new Set<string>();
    for (const source of group.from) if (source !== group.to) sources.add(source);
    sourcesByTarget.set(group.to, sources);
  }
  const unobserved = [...sourcesByTarget.keys()].filter((target) => !observed.has(target));
  const wide = [...sourcesByTarget].filter(([, sources]) => sources.size > CATEGORY_TARGET_MAX_SOURCES).map(([target]) => target);
  const parts: string[] = [];
  if (unobserved.length > 0) {
    parts.push(
      `${humanEdited ? 'human-introduced' : 'unobserved'} target(s) not in the column: ${unobserved.map((t) => JSON.stringify(t)).join(', ')}`,
    );
  }
  if (wide.length > 0) {
    parts.push(
      `target(s) absorbing more than ${CATEGORY_TARGET_MAX_SOURCES} sources: ${wide.map((target) => JSON.stringify(target)).join(', ')}`,
    );
  }
  if (parts.length === 0) return [];
  return [
    hit('category_target', step, step.columns, `${parts.join('; ')}.`, {
      unobserved_targets: unobserved.length,
      wide_targets: wide.length,
    }),
  ];
}

// --- drop_duplicate_rows ------------------------------------------------------------------------------

function dedupGuards(table: Table, step: PlanStep, ctx: PlanContext): GuardHit[] {
  const laterTrim = ctx.steps.slice(ctx.index + 1).some((s) => s.op === 'trim_whitespace');
  const earlierTrim = ctx.steps
    .slice(0, Math.max(0, ctx.index))
    .some((s, j) => s.op === 'trim_whitespace' && ctx.applied?.[j] !== false);
  const exact = exactDuplicateRows(table);
  const afterTrim = duplicateRowsAfterTrim(table);
  const hiddenByPadding = afterTrim > exact && !earlierTrim;
  if (!laterTrim && !hiddenByPadding) return [];
  const message = laterTrim
    ? 'A trim step comes later: rows that differ only by padding are not duplicates yet. Trim first.'
    : `${afterTrim - exact} more duplicate row(s) appear after trimming whitespace, and no trim step runs first.`;
  return [hit('dedup_before_trim', step, [], message, { exact_duplicates: exact, duplicates_after_trim: afterTrim })];
}

/** Every guard hit for one accepted step on its predecessor table. */
export function evaluateGuards(predecessor: Table, step: PlanStep, planContext: PlanContext): GuardHit[] {
  let hits: GuardHit[] = [];
  switch (step.op) {
    case 'parse_number': {
      const p = ParseNumberParams.safeParse(step.params);
      if (p.success) hits = numberGuards(predecessor, step, p.data);
      break;
    }
    case 'standardize_date': {
      const p = StandardizeDateParams.safeParse(step.params);
      if (p.success) hits = dateGuards(predecessor, step, p.data.from_format);
      break;
    }
    case 'null_tokens': {
      const p = NullTokensParams.safeParse(step.params);
      if (p.success) hits = nullGuards(predecessor, step, p.data.tokens);
      break;
    }
    case 'normalize_case': {
      const p = NormalizeCaseParams.safeParse(step.params);
      if (p.success && p.data.mode === 'title') hits = titleGuards(predecessor, step);
      break;
    }
    case 'map_categories': {
      const p = MapCategoriesParams.safeParse(step.params);
      if (p.success) hits = categoryGuards(predecessor, step, p.data.groups, planContext.humanEdited === true);
      break;
    }
    case 'drop_duplicate_rows':
      hits = dedupGuards(predecessor, step, planContext);
      break;
    default:
      break;
  }
  return hits.sort((a, b) => GUARD_IDS.indexOf(a.guard) - GUARD_IDS.indexOf(b.guard));
}

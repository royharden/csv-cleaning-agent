/**
 * Deterministic offline proposals (C §2.8). No model, network or mutation.
 * Bind the actual table with createRulesPlanner(table) for app/eval use: every proposed suffix is profiled on
 * the tentative predecessor with the real M2 apply engine. Review still recomputes on APPROVED predecessors.
 * Without a table, only complete category_values can reconstruct column evidence; incomplete columns are
 * explicitly skipped. Never treat the outbound eight strings as the full local distribution.
 */
import {
  CURRENCY_MARKERS,
  NULL_TOKENS,
  PLAN_MAX_STEPS,
  RULES_DATE_SHARE_MIN,
  RULES_NUMERIC_SHARE_MIN,
  type DateFormat,
  type OpName,
} from '../constants.ts';
import type { OutboundProfile } from '../profile/outbound.ts';
import { buildLocalProfile, columnValueCounts, exactDuplicateRows, profileColumn, type LocalProfile } from '../profile/profile.ts';
import { isInstructionLike } from '../profile/withhold.ts';
import { createTable, type ColumnId, type Table } from '../table.ts';
import { evaluateGuards, hasMixedCaseWord } from '../transformkit/guards.ts';
import { parseNumberCell, type NumberGrammar } from '../transformkit/grammar/number.ts';
import { snakeCase } from '../transformkit/ops/rename_headers.ts';
import { applyStep, OPS, type PlanStep } from '../transformkit/registry.ts';
import type { Planner, PlannerResult } from './types.ts';

export interface RulesResult extends PlannerResult {
  readonly steps: readonly PlanStep[];
  readonly source: 'rules';
  readonly notes: readonly string[];
}

/** Keep word boundaries, strip ASCII punctuation only, and use a fixed locale. No edit-distance merging. */
export function categoryKey(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/[!-/:-@[-`{-~]/g, '').replace(/\s+/gu, ' ').trim();
}

function hasEffect(table: Table, step: PlanStep): boolean {
  const counts = applyStep(table, step).counts;
  return counts.changed > 0 || counts.headers > 0 || counts.dropped > 0;
}

function valuesOf(table: Table, id: ColumnId): string[] {
  const index = table.cols.findIndex((c) => c.id === id);
  return table.rows.flatMap((row) => index < row.length && row[index] !== '' ? [row[index]] : []);
}

/** Evidence must itself pass the complete grammar; malformed separator strings prove nothing. */
function conventionProven(values: readonly string[], grammar: NumberGrammar): boolean {
  let fractionProof = false;
  let separatorSeen = false;
  for (const value of values) {
    const parsed = parseNumberCell(value, grammar);
    if (!parsed.ok) continue;
    if (value.includes('.') || value.includes(',')) separatorSeen = true;
    if (parsed.fraction !== null && (parsed.grouped || parsed.fraction.length !== 3)) fractionProof = true;
  }
  // For separator-free integers/currency amounts there is no decimal/thousands choice to infer.
  return fractionProof || !separatorSeen;
}

function categoryGroups(table: Table, id: ColumnId): { from: string[]; to: string }[] {
  const index = table.cols.findIndex((c) => c.id === id);
  const values = columnValueCounts(table, index);
  // Deliberate mixed-case names (McDonald, iPhone, van Gogh) are never flattened by a category proposal either.
  if (values.some(({ value }) => hasMixedCaseWord(value))) return [];
  const buckets = new Map<string, { value: string; count: number }[]>();
  for (const member of values) {
    if (isInstructionLike(member.value)) continue;
    const key = categoryKey(member.value);
    if (key === '') continue;
    const bucket = buckets.get(key) ?? [];
    bucket.push(member);
    buckets.set(key, bucket);
  }
  return [...buckets].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).flatMap(([, members]) => {
    // columnValueCounts already sorted by frequency descending, then code-unit lexical order.
    if (members.length < 2) return [];
    return [{ from: members.slice(1).map((v) => v.value), to: members[0].value }];
  });
}

/**
 * Synchronous pure entrypoint. `table` is optional only for conservative profile-only callers.
 * The outbound profile authorizes ColumnIds; local labels/full values are never sent anywhere.
 */
export function planRules(outbound: OutboundProfile, local: LocalProfile, table?: Table): RulesResult {
  const steps: PlanStep[] = [];
  const notes: string[] = [];
  let current = table;
  const profile = table === undefined ? local : buildLocalProfile(table);
  const allowed = new Set(outbound.columns.map((c) => c.id));
  const included = profile.columns.filter((c) => allowed.has(c.id));
  if (outbound.columns.some((c) => !profile.columns.some((p) => p.id === c.id))) {
    throw new Error('Rules planner received an outbound ColumnId absent from the local profile; rebuild both profiles.');
  }
  const columnTables = new Map<ColumnId, Table>();
  if (current === undefined) {
    for (const column of included) {
      if (column.category_values === null) {
        notes.push(`${column.id}: full values unavailable above 60 distinct; bind the original table with createRulesPlanner(table).`);
        continue;
      }
      const rows = column.category_values.flatMap(({ value, count }) => Array.from({ length: count }, () => [value]));
      columnTables.set(column.id, createTable([{ id: column.id, name: column.name }], rows));
    }
  }
  const evidence = (id: ColumnId): Table | undefined => current ?? columnTables.get(id);
  function proposal(op: OpName, columns: readonly ColumnId[], params: unknown, rationale: string): PlanStep {
    return { id: `rules-${steps.length + 1}`, op, columns, params, rationale };
  }
  function add(step: PlanStep, basis?: Table): boolean {
    // Leave one card for final exact deduplication. A bounded prefix is explicit, never an oversized plan.
    if (steps.length >= PLAN_MAX_STEPS - (step.op === 'drop_duplicate_rows' ? 0 : 1)) {
      notes.push(`Plan limit ${PLAN_MAX_STEPS}: further ${step.op} proposals omitted.`);
      return false;
    }
    if (basis !== undefined && !hasEffect(basis, step)) return false;
    steps.push(step);
    if (current !== undefined) current = applyStep(current, step).table;
    else {
      for (const id of step.columns) {
        const colTable = columnTables.get(id);
        if (colTable !== undefined) columnTables.set(id, applyStep(colTable, { ...step, columns: [id] }).table);
      }
    }
    return true;
  }

  const trimColumns = included.filter((c) => Object.values(c.whitespace).some((count) => count > 0)).map((c) => c.id);
  if (trimColumns.length > 0) {
    add(proposal('trim_whitespace', trimColumns,
      { ends: true, collapse_inner: true, nbsp: true, zero_width: true }, 'Remove observed whitespace artifacts before interpreting values.'), current);
  }
  const renameColumns = included.filter((c) => snakeCase(c.name) !== c.name).map((c) => c.id);
  if (renameColumns.length > 0) {
    const headerTable = current ?? createTable(profile.columns.map((c) => ({ id: c.id, name: c.name })), []);
    const step = proposal('rename_headers', renameColumns, {}, 'Use snake_case display headers; keep immutable ColumnIds.');
    const problems = OPS.rename_headers.check(headerTable, step, { humanEdited: false });
    if (problems.length === 0) add(step, headerTable);
    else notes.push(`Headers left untouched: ${problems.map((p) => p.message).join('; ')}`);
  }

  for (const original of included) {
    let basis = evidence(original.id);
    if (basis === undefined) continue;
    const id = original.id;
    const getProfile = () => {
      const value = evidence(id);
      if (value === undefined) throw new Error(`Missing local evidence for ${id}.`);
      return profileColumn(value, value.cols.findIndex((c) => c.id === id));
    };
    const beforeNull = getProfile();
    const tokens = NULL_TOKENS.filter((token) => beforeNull.null_tokens.some((n) => n.token === token));
    const tokenBasis = basis;
    const safeTokens = tokens.filter((token) => {
      const step = proposal('null_tokens', [id], { tokens: [token] }, '');
      return !evaluateGuards(tokenBasis, step, { steps: [step], index: 0 }).some((h) => h.guard === 'null_shape_majority');
    });
    if (safeTokens.length > 0) {
      add(proposal('null_tokens', [id], { tokens: safeTokens }, 'Null only exact tokens whose shape is not the majority.'), basis);
    }
    basis = evidence(id);
    if (basis === undefined) continue;
    const column = getProfile();
    if (column.non_empty === 0) continue;
    const values = valuesOf(basis, id);
    let typed = false;
    // A date is considered before numbers so compact YYYYMMDD cannot be treated as an amount.
    const dates = column.date_formats.filter((d) => d.count / column.non_empty >= RULES_DATE_SHARE_MIN)
      .sort((a, b) => b.count - a.count); // stable whitelist order resolves equal counts
    for (const candidate of dates) {
      const format: DateFormat = candidate.format;
      const step = proposal('standardize_date', [id], { from_format: format }, 'A single date format fits at least 90% with proven order.');
      if (evaluateGuards(basis, step, { steps: [step], index: 0 }).some((h) => h.guard === 'date_order')) continue;
      typed = true;
      add(step, basis);
      break;
    }
    // A column containing ambiguous/contradictory dates must not fall through into category merging.
    if (!typed && dates.length > 0) typed = true;
    if (!typed && column.leading_zero === 0) {
      const conventions = column.number_conventions.filter((n) => n.count / column.non_empty >= RULES_NUMERIC_SHARE_MIN)
        .sort((a, b) => b.count - a.count);
      for (const convention of conventions) {
        const params: NumberGrammar = { decimal: convention.decimal, thousands: convention.thousands,
          currency: [...CURRENCY_MARKERS], parens_negative: true };
        const step = proposal('parse_number', [id], params, 'At least 90% match a proven numeric convention without leading zeros.');
        if (!conventionProven(values, params)) continue;
        if (evaluateGuards(basis, step, { steps: [step], index: 0 }).length > 0) continue;
        typed = true;
        add(step, basis);
        break;
      }
    }
    // Failed/guarded numeric inference must not fall through and merge e.g. 1,234 with 1.234 by punctuation.
    const numericLike = values.filter((value) => column.number_conventions.some((convention) =>
      parseNumberCell(value, { decimal: convention.decimal, thousands: convention.thousands,
        currency: [...CURRENCY_MARKERS], parens_negative: true }).ok)).length;
    if (column.leading_zero > 0 || numericLike / column.non_empty >= RULES_NUMERIC_SHARE_MIN) typed = true;
    if (!typed && column.category_values !== null) {
      const groups = categoryGroups(basis, id);
      if (groups.length > 0) add(proposal('map_categories', [id], { groups },
        'Merge only case, ASCII punctuation and whitespace variants; retain the most frequent observed member.'), basis);
    }
  }
  const exact = current === undefined ? profile.exact_duplicate_rows : exactDuplicateRows(current);
  const trimmed = trimColumns.length > 0 && profile.duplicate_rows_after_trim > profile.exact_duplicate_rows;
  if (exact > 0 || (current === undefined && trimmed)) {
    add(proposal('drop_duplicate_rows', [], {}, 'Remove whole-record exact duplicates last; retain first occurrence and actual width.'), current);
  }
  return { steps, source: 'rules', notes };
}

/** Recommended app/eval adapter: capture the table locally, keep the common planner interface. */
export function createRulesPlanner(table: Table): Planner {
  return { async plan(outbound, local) { return planRules(outbound, local ?? buildLocalProfile(table), table); } };
}

/** Profile-only compatibility adapter. Incomplete evidence yields explicit notes, never invented proof. */
export const rulesPlanner: Planner = {
  async plan(outbound, local) {
    if (local === undefined) throw new Error('Rules planner requires a local profile; use createRulesPlanner(table).');
    return planRules(outbound, local);
  },
};

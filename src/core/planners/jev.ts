import { JEV_MAX_PAIRS_PER_REQUEST } from '../constants.ts';
import type { OutboundProfile } from '../profile/outbound.ts';
import type { LocalProfile } from '../profile/profile.ts';
import { isInstructionLike } from '../profile/withhold.ts';
import type { ColumnId, Table } from '../table.ts';
import type { PlanStep } from '../transformkit/registry.ts';
import { hashOutboundProfile, loadFixture } from './fixture.ts';
import type { Invoke } from './llm.ts';
import { planRules } from './rules.ts';
import type { PlannerResult } from './types.ts';

export interface JudgePair { readonly column: ColumnId; readonly a: string; readonly b: string; readonly siblings: readonly string[] }
export interface PairScore { readonly column: ColumnId; readonly a: string; readonly b: string; readonly score: number }
export interface Coverage { readonly eligible: number; readonly full_vocabulary: number }
export interface JevResult extends PlannerResult {
  readonly coverage: Coverage; readonly bridges: readonly { readonly column: ColumnId; readonly members: readonly string[]; readonly below_threshold_pairs: readonly PairScore[] }[];
  readonly candidates: Readonly<Record<ColumnId, readonly string[]>>;
}
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export function judgeRequests(profile: OutboundProfile, local: LocalProfile): readonly { readonly profile: OutboundProfile; readonly pairs: readonly JudgePair[] }[] {
  const pairs: JudgePair[] = [];
  for (const column of profile.columns) {
    const full = local.columns.find((c) => c.id === column.id);
    if (full === undefined || full.distinct > 60 || full.category_values === null) continue;
    const values = column.values.filter((v) => v.truncated !== true && !isInstructionLike(v.value) && v.value !== '').map((v) => v.value).sort(compare);
    for (let a = 0; a < values.length; a += 1) for (let b = a + 1; b < values.length; b += 1) {
      pairs.push({ column: column.id, a: values[a], b: values[b], siblings: values.filter((v) => v !== values[a] && v !== values[b]).slice(0, 6) });
    }
  }
  const requests: { readonly profile: OutboundProfile; readonly pairs: readonly JudgePair[] }[] = [];
  let batch: JudgePair[] = [];
  for (const pair of pairs) {
    const next = [...batch, pair];
    if (next.length > JEV_MAX_PAIRS_PER_REQUEST || new TextEncoder().encode(JSON.stringify({ profile, pairs: next })).length > 65_536) {
      if (batch.length === 0) throw new Error('A category pair cannot fit the 65536-byte request cap; exclude more columns.');
      requests.push({ profile, pairs: batch }); batch = [pair];
    } else batch = next;
  }
  if (batch.length > 0) requests.push({ profile, pairs: batch });
  return requests;
}
export function frozenThresholds(value: unknown, columns: readonly ColumnId[]): ReadonlyMap<ColumnId, number> {
  if (value === null || typeof value !== 'object' || !('status' in value) || value.status !== 'frozen' ||
    !('freeze_date' in value) || typeof value.freeze_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.freeze_date) ||
    !('thresholds' in value) || value.thresholds === null || typeof value.thresholds !== 'object') {
    throw new Error('Jev thresholds are not frozen. Tune per-column thresholds on dev seeds only; record status=frozen, freeze_date and thresholds before live/held-out evaluation.');
  }
  const thresholds = value.thresholds as Record<string, unknown>;
  return new Map(columns.map((id) => {
    const threshold = thresholds[id];
    if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error(`Missing frozen Jev threshold for ${id}.`);
    return [id, threshold];
  }));
}
export function scoredGroups(values: readonly { readonly value: string; readonly count: number }[], scores: readonly PairScore[], threshold: number) {
  const names = values.map((v) => v.value).sort(compare); const parent = new Map(names.map((v) => [v, v]));
  const root = (value: string): string => { let cursor = value; while (parent.get(cursor) !== cursor) cursor = parent.get(cursor)!; return cursor; };
  const seen = new Set<string>();
  for (const pair of scores) {
    const key = JSON.stringify([pair.a, pair.b].sort(compare));
    if (!parent.has(pair.a) || !parent.has(pair.b) || pair.a === pair.b || seen.has(key) || !Number.isFinite(pair.score) || pair.score < 0 || pair.score > 1) throw new Error('Jev returned unknown/repeated pair or invalid probability.');
    seen.add(key);
  }
  if (scores.length !== names.length * (names.length - 1) / 2) throw new Error('Jev scores do not cover every requested pair.');
  const ordered = [...scores].sort((a, b) => b.score - a.score || compare([a.a, a.b].sort(compare).join('\0'), [b.a, b.b].sort(compare).join('\0')));
  for (const pair of ordered) if (pair.score >= threshold) { const a = root(pair.a); const b = root(pair.b); if (a !== b) parent.set(compare(a, b) < 0 ? b : a, compare(a, b) < 0 ? a : b); }
  const buckets = new Map<string, string[]>();
  for (const value of names) { const key = root(value); buckets.set(key, [...(buckets.get(key) ?? []), value]); }
  const groups = [...buckets.values()].filter((members) => members.length > 1).map((members) => ({
    from: members, to: [...members].sort((a, b) => (values.find((v) => v.value === b)?.count ?? 0) - (values.find((v) => v.value === a)?.count ?? 0) || compare(a, b))[0],
  }));
  const bridges = groups.flatMap((group) => {
    const below = scores.filter((pair) => group.from.includes(pair.a) && group.from.includes(pair.b) && pair.score < threshold);
    return below.length === 0 ? [] : [{ members: group.from, below_threshold_pairs: below }];
  });
  return { groups, bridges };
}
export async function jevOnRules(table: Table, profile: OutboundProfile, local: LocalProfile,
  options: { readonly fixtures: readonly unknown[] } | { readonly invoke: Invoke; readonly thresholds: unknown }): Promise<JevResult> {
  const requests = judgeRequests(profile, local); const requested = requests.flatMap((r) => r.pairs);
  let judged = [...new Set(requested.map((p) => p.column))];
  let scores: PairScore[] = []; let source: PlannerResult['source'] = 'live';
  let thresholds: ReadonlyMap<ColumnId, number>; let usage: { input_tokens: number; output_tokens: number } | undefined;
  let usageKnown = true;
  if ('fixtures' in options) {
    const fixture = loadFixture(options.fixtures, 'jev', await hashOutboundProfile(profile));
    if (fixture.planner !== 'jev') throw new Error('Expected Jev pair fixture.');
    judged = fixture.pairs.map((c) => c.column);
    source = fixture.source; thresholds = new Map(judged.map((id) => [id, fixture.threshold]));
    scores = fixture.pairs.flatMap((c) => c.pairs.map((p) => ({ ...p, column: c.column })));
  } else {
    thresholds = frozenThresholds(options.thresholds, judged);
    for (const request of requests) {
      const response = await options.invoke('judge-categories', request);
      if (!Array.isArray(response.scores)) throw new Error('Jev response lacks scores.');
      scores.push(...response.scores);
      if (response.usage?.input_tokens != null && response.usage.output_tokens != null) {
        usage ??= { input_tokens: 0, output_tokens: 0 }; usage.input_tokens += response.usage.input_tokens; usage.output_tokens += response.usage.output_tokens;
      } else usageKnown = false;
    }
    if (scores.length !== requested.length) throw new Error('Jev response did not score every requested pair exactly once.');
  }
  // Reject any response/fixture outside exactly the screened, untruncated request set.
  if (scores.some((s) => !requested.some((p) => p.column === s.column && ((p.a === s.a && p.b === s.b) || (p.a === s.b && p.b === s.a))))) throw new Error('Jev score contains an undisclosed pair.');
  const rules = planRules(profile, local, table);
  const kept = rules.steps.filter((step) => !(step.op === 'map_categories' && step.columns.some((id) => judged.includes(id))));
  // Category judgments apply first to the exact disclosed spellings. Every proposal remains human-reviewed.
  const steps: PlanStep[] = []; const bridges: JevResult['bridges'][number][] = [];
  const candidates = Object.fromEntries(judged.map((id) => [id, [...new Set(scores.filter((s) => s.column === id).flatMap((s) => [s.a, s.b]))].sort(compare)]));
  const eligible = Object.values(candidates).reduce((n, values) => n + values.length, 0);
  const full = judged.reduce((n, id) => n + (local.columns.find((p) => p.id === id)?.distinct ?? 0), 0);
  for (const id of judged) {
    const column = profile.columns.find((c) => c.id === id)!; const values = column.values.filter((v) => candidates[id].includes(v.value));
    const groups = scoredGroups(values, scores.filter((s) => s.column === id), thresholds.get(id)!);
    bridges.push(...groups.bridges.map((bridge) => ({ ...bridge, column: id })));
    if (groups.groups.length > 0) steps.push({ id: `jev-${id}`, op: 'map_categories', columns: [id], params: { groups: groups.groups }, rationale: 'Jev scored disclosed category pairs; target is the most frequent observed member.' });
  }
  // Keep rule operations and their dedup-last order; actual review recomputes predecessors and guards.
  const result = [...steps, ...kept];
  // Source inspection helper: applying is deliberately left to the validator/review path.
  return { steps: result, source: source === 'live' && requests.length === 0 ? 'rules' : source, coverage: { eligible, full_vocabulary: full }, candidates, bridges,
    ...(usage === undefined || !usageKnown ? {} : { usage }), notes: [`${eligible} of ${full} distinct category values judged.`, `${bridges.length} transitive bridge groups; no repair calls.`] };
}

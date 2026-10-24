import type { OutboundProfile } from '../profile/outbound.ts';
import type { Table } from '../table.ts';
import { validatePlan } from '../transformkit/validator.ts';
import type { Planner, PlannerResult } from './types.ts';

export interface ProviderReply {
  readonly ok: true; readonly raw: string; readonly usage: { readonly input_tokens: number | null; readonly output_tokens: number | null } | null;
  readonly raw_usage?: unknown; readonly provider: string; readonly model: string;
  readonly request_id: string; readonly latency_ms: number;
  readonly scores?: readonly { readonly column: string; readonly a: string; readonly b: string; readonly score: number }[];
}
export type Invoke = (name: 'propose-plan' | 'judge-categories', body: unknown) => Promise<ProviderReply>;
export function proposeRequest(profile: OutboundProfile): { readonly profile: OutboundProfile } { return { profile }; }
/** First object only. Braces inside JSON strings do not end the object. Never repairs/retries. */
export function firstJsonObject(raw: string): unknown {
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('Model output contains no JSON object.');
  let depth = 0; let quoted = false; let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return JSON.parse(raw.slice(start, i + 1)) as unknown;
  }
  throw new Error('First model JSON object is incomplete.');
}
export function parseModelPlan(raw: string, table: Table, profile: OutboundProfile): PlannerResult {
  try {
    const plan = firstJsonObject(raw);
    const checked = validatePlan(plan, { table, outboundColumnIds: profile.columns.map((c) => c.id),
      excludedColumnIds: table.cols.filter((c) => !profile.columns.some((p) => p.id === c.id)).map((c) => c.id) });
    const notes = [...checked.plan_reasons, ...checked.rejected.map((r) => `Rejected ${r.step_id ?? r.index}: ${r.reasons.join('; ')}`)];
    const accepted = checked.accepted.filter(({ step }) => {
      if (step.op !== 'map_categories') return true;
      const allowed = new Set(profile.columns.find((c) => c.id === step.columns[0])?.values.filter((v) => v.truncated !== true).map((v) => v.value) ?? []);
      const groups = (step.params as { groups: readonly { from: readonly string[]; to: string }[] }).groups;
      if (groups.some((g) => !allowed.has(g.to) || g.from.some((value) => !allowed.has(value)))) {
        notes.push(`Rejected ${step.id}: category mapping references a withheld, truncated or undisclosed value.`); return false;
      }
      return true;
    });
    // Review recomputes accepted items on human-kept predecessors. Rejections are displayed as notes.
    return { steps: accepted.map((item) => item.step), raw, source: 'live', notes };
  } catch (error) {
    return { steps: [], raw, source: 'live', notes: [`Model output rejected: ${error instanceof Error ? error.message : String(error)} No repair call was made.`] };
  }
}
export function createLlmPlanner(table: Table, invoke: Invoke): Planner {
  return { async plan(profile) {
    const response = await invoke('propose-plan', proposeRequest(profile));
    const usage = response.usage;
    return { ...parseModelPlan(response.raw, table, profile), ...(usage?.input_tokens == null || usage.output_tokens === null ? {} : { usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } }) };
  } };
}

/** Method registry. No network in M5: fixture replay never impersonates a live call. */
import { createRulesPlanner } from '../../src/core/planners/rules.ts';
import { FixtureError, hashOutboundProfile, loadFixture, validateFixtureRecords } from '../../src/core/planners/fixture.ts';
import type { PlannerUsage } from '../../src/core/planners/types.ts';
import type { LocalProfile } from '../../src/core/profile/profile.ts';
import type { OutboundProfile } from '../../src/core/profile/outbound.ts';
import type { Table } from '../../src/core/table.ts';
import type { SeededDataset } from '../seededdirty/manifest.ts';
import { createLlmPlanner } from '../../src/core/planners/llm.ts';
import { jevOnRules } from '../../src/core/planners/jev.ts';
import { hashTable } from '../../src/core/journal/hash.ts';
import { parseDirect } from './llm_direct.ts';
import type { LiveRuntime } from './ledger.ts';
import type { JevResult } from '../../src/core/planners/jev.ts';
export type MethodId = 'rules' | 'llm' | 'jev-on-rules' | 'llm_direct';
export type Provenance = 'measured-live' | 'recorded' | 'synthetic-fixture' | 'not yet measured';
export interface MethodContext {
  readonly data: SeededDataset; readonly local: LocalProfile; readonly outbound: OutboundProfile;
  readonly fixtures: readonly unknown[];
  readonly live?: LiveRuntime;
}
export interface MeasurementMeta {
  readonly provenance: Exclude<Provenance, 'not yet measured'>;
  readonly fixture_id?: string; readonly model?: string; readonly provider?: string; readonly usage?: PlannerUsage;
  /** Missing billing/latency is unknown, never zero. Offline rules has known zero provider spend. */
  readonly cost_usd: number | null; readonly latency_ms: number | null;
  readonly candidate_coverage?: { readonly eligible: number; readonly full_vocabulary: number };
  readonly category_candidates?: Readonly<Record<string, readonly string[]>>;
  readonly transitive_bridges?: JevResult['bridges'];
}
export type MethodResult =
  | { readonly status: 'not yet measured'; readonly reason: string }
  | ({ readonly status: 'measured'; readonly kind: 'plan'; readonly steps: readonly unknown[] } & MeasurementMeta)
  | ({ readonly status: 'measured'; readonly kind: 'direct'; readonly output: Table } & MeasurementMeta);
export interface EvalMethod {
  readonly id: MethodId; readonly baseline: boolean; readonly review_modes: boolean;
  readonly propose: (context: MethodContext) => Promise<MethodResult>;
}
const pending = (reason: string): MethodResult => ({ status: 'not yet measured', reason });
export const METHODS: readonly EvalMethod[] = [
  { id: 'rules', baseline: true, review_modes: true, async propose(context) {
    const start = performance.now();
    const result = await createRulesPlanner(context.data.dirty).plan(context.outbound, context.local);
    // Deterministic local code; recorded identifies this execution, never a model measurement.
    return { status: 'measured', kind: 'plan', steps: result.steps, provenance: 'recorded',
      provider: 'offline-rules', model: 'none', cost_usd: 0, latency_ms: performance.now() - start };
  } },
  { id: 'llm_direct', baseline: true, review_modes: false, async propose(context) {
    if (context.live === undefined) return pending('llm_direct requires explicit --live, synthetic matched 200x6 input and an owner-priced reservation ledger.');
    if (context.data.dirty.rows.length > 200 || context.data.dirty.cols.length > 6) return pending('llm_direct is bounded to the matched 200x6 population.');
    context.live.begin();
    const response = await context.live.direct(context.data.dirty, await hashTable(context.data.dirty));
    return { status: 'measured', kind: 'direct', output: parseDirect(response.raw, context.data.dirty), provenance: 'measured-live', ...context.live.last() };
  } },
  { id: 'llm', baseline: false, review_modes: true, async propose(context) {
    if (context.live !== undefined) {
      context.live.begin();
      const result = await createLlmPlanner(context.data.dirty, context.live.invoke).plan(context.outbound, context.local);
      return { status: 'measured', kind: 'plan', steps: result.steps, provenance: 'measured-live', ...context.live.last(),
        ...(result.usage === undefined ? {} : { usage: result.usage }) };
    }
    try {
      const fixtures = validateFixtureRecords(context.fixtures);
      const payload = loadFixture(fixtures, 'llm', await hashOutboundProfile(context.outbound));
      if (payload.planner !== 'llm') throw new Error('Fixture planner mismatch');
      return { status: 'measured', kind: 'plan', steps: payload.steps,
        provenance: payload.source === 'synthetic-fixture' ? 'synthetic-fixture' : 'recorded',
        fixture_id: payload.fixture_id, cost_usd: null, latency_ms: null };
    } catch (error) {
      if (error instanceof FixtureError && (error.code === 'fixture_missing' || error.code === 'fixture_not_keyed')) return pending(error.message);
      throw error;
    }
  } },
  { id: 'jev-on-rules', baseline: false, review_modes: true, async propose(context) {
    try {
      context.live?.begin();
      const result = await jevOnRules(context.data.dirty, context.outbound, context.local, context.live === undefined
        ? { fixtures: context.fixtures } : { invoke: context.live.invoke, thresholds: context.live.thresholds });
      return { status: 'measured', kind: 'plan', steps: result.steps,
        provenance: context.live !== undefined && result.source === 'live' ? 'measured-live' : result.source === 'synthetic-fixture' ? 'synthetic-fixture' : 'recorded',
        ...(context.live === undefined ? { cost_usd: null, latency_ms: null } : context.live.last()),
        candidate_coverage: result.coverage, transitive_bridges: result.bridges,
        category_candidates: result.candidates,
        ...(result.usage === undefined ? {} : { usage: result.usage }) };
    } catch (error) {
      if (context.live === undefined && error instanceof FixtureError && (error.code === 'fixture_missing' || error.code === 'fixture_not_keyed')) return pending(error.message);
      throw error;
    }
  } },
];
export function methodById(id: string): EvalMethod {
  const method = METHODS.find((candidate) => candidate.id === id);
  if (method === undefined) throw new Error(`Unknown eval method ${id}`);
  return method;
}

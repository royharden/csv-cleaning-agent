import { describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createTable } from '../../src/core/table.ts';
import { buildLocalProfile } from '../../src/core/profile/profile.ts';
import { buildOutboundProfile } from '../../src/core/profile/outbound.ts';
import { isInstructionLike } from '../../src/core/profile/withhold.ts';
import { frozenThresholds, judgeRequests, scoredGroups, jevOnRules } from '../../src/core/planners/jev.ts';
import { hashOutboundProfile } from '../../src/core/planners/fixture.ts';
import { createLiveRuntime } from '../../scripts/eval/ledger.ts';
import { INJECTION_TEST_VALUE, runJevHarness } from '../../scripts/eval/jev-harness.ts';

describe('offline Jev disclosure and deterministic grouping', () => {
  it('withholds answer-yes injection and excludes it from every browser request', () => {
    expect(isInstructionLike(INJECTION_TEST_VALUE)).toBe(true);
    const table = createTable([{ id: 'c0', name: 'city' }], [['NYC'], ['New York'], [INJECTION_TEST_VALUE], ['x'.repeat(41)]]);
    const local = buildLocalProfile(table); const profile = buildOutboundProfile(table, local, { excludedColumnIds: [] }).profile;
    const requests = judgeRequests(profile, local);
    expect(JSON.stringify(profile)).not.toContain(INJECTION_TEST_VALUE);
    expect(JSON.stringify(requests)).not.toContain(INJECTION_TEST_VALUE);
    expect(requests.flatMap((request) => request.pairs).some((p) => p.a === 'x'.repeat(40) || p.b === 'x'.repeat(40))).toBe(false);
  });
  it('measures a low-scored transitive bridge without extra calls and is invariant to pair order', () => {
    const values = [{ value: 'A', count: 1 }, { value: 'B', count: 3 }, { value: 'C', count: 1 }];
    const scores = [{ column: 'c0', a: 'A', b: 'B', score: 0.95 }, { column: 'c0', a: 'B', b: 'C', score: 0.9 }, { column: 'c0', a: 'A', b: 'C', score: 0.1 }];
    const result = scoredGroups(values, scores, 0.8);
    expect(result.groups).toEqual([{ from: ['A', 'B', 'C'], to: 'B' }]);
    expect(result.bridges).toHaveLength(1);
    expect(scoredGroups([...values].reverse(), [...scores].reverse(), 0.8)).toEqual(result);
    expect(() => frozenThresholds({ status: 'not yet frozen' }, ['c0'])).toThrow(/not frozen/);
  });
  it('replays only fixture-scored pairs keylessly with a fixture-only threshold', async () => {
    const table = createTable([{ id: 'c0', name: 'city' }, { id: 'c1', name: 'other' }], [['NYC', 'A'], ['New York', 'B'], ['New York', 'C']]);
    const local = buildLocalProfile(table); const profile = buildOutboundProfile(table, local, { excludedColumnIds: [] }).profile;
    const fixture = { fixture_id: 'synthetic-pairs', planner: 'jev', source: 'synthetic-fixture', source_csv: 'synthetic.csv',
      excluded_column_ids: [], profile_hash: await hashOutboundProfile(profile), threshold: 0.9,
      pairs: [{ column: 'c0', pairs: [{ a: 'NYC', b: 'New York', score: 0.98 }] }] };
    const result = await jevOnRules(table, profile, local, { fixtures: [fixture] });
    expect(result.source).toBe('synthetic-fixture'); expect(result.coverage).toEqual({ eligible: 2, full_vocabulary: 2 });
    expect(result.steps[0]).toMatchObject({ op: 'map_categories', columns: ['c0'], params: { groups: [{ to: 'New York' }] } });
  });
});
// Keys alone never trigger paid tests: owner opts in and supplies a dated price table too.
const liveReady = Boolean(process.env.TYPESAFE_API_KEY && process.env.EVAL_PRICE_TABLE && process.env.LIVE_JEV_TESTS === '1');
describe.skipIf(!liveReady)('live synthetic Jev robustness (explicit injection test pair)', () => {
  it('runs source-order shuffle, injection, transitive bridge measurement and sibling ablation serially', async () => {
    const root = resolve('.'); await mkdir(join(root, 'results'), { recursive: true });
    const live = await createLiveRuntime(root, join(root, 'results', `jev-test-ledger-${Date.now()}.jsonl`));
    live.begin(); const threshold = frozenThresholds(live.thresholds, ['c0']).get('c0')!;
    const result = await runJevHarness(live.testPair, threshold);
    expect(result.order_pass).toBe(true); expect(result.injection_pass).toBe(true);
    expect(Number.isFinite(result.sibling_ablation_delta)).toBe(true);
    expect(result.observations).toHaveLength(8);
  }, 240_000);
});

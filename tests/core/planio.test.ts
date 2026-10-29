import { describe, expect, it } from 'vitest';
import { exportPlan, importPlan } from '../../src/core/plan/io.ts';
import { createReviewState, decide } from '../../src/core/review/state.ts';
import { createTable } from '../../src/core/table.ts';
import type { PlanStep } from '../../src/core/transformkit/registry.ts';
import { TIME, trim } from '../fixtures/m3.ts';

describe('plan import original-header resolution', () => {
  const original = createTable([{ id: 'c0', name: 'amount' }, { id: 'c1', name: 'city' }], [[' 1 ', 'NYC']]);
  const serialized = exportPlan({ version: 1, steps: [trim] }, original);
  it('resolves by exact original name on another file, then reviews without approvals', async () => {
    const target = createTable([{ id: 'c0', name: 'city' }, { id: 'c1', name: 'amount' }], [['NYC', ' 2 ']]);
    const result = importPlan(serialized, target);
    expect(result.plan.steps[0].columns).toEqual(['c1']);
    expect(result.approvals).toEqual([]);
    const review = await createReviewState(target, result.plan, { outboundColumnIds: ['c0', 'c1'], excludedColumnIds: [] });
    expect(review.cards[0].status).toBe('pending');
  });
  it('preserves a dependent map on round-trip while review waits for its trim approval', async () => {
    const input = createTable([{ id: 'c0', name: 'city' }], [[' NYC '], ['New York']]);
    const map: PlanStep = { id: 'map', op: 'map_categories', columns: ['c0'], params: { groups: [{ from: ['NYC'], to: 'New York' }] } };
    const plan = { version: 1 as const, steps: [trim, map] };
    const result = importPlan(exportPlan(plan, input), input);
    expect(result.validation.rejected).toEqual([]);
    expect(result.plan.steps).toEqual(plan.steps);
    expect(result.approvals).toEqual([]);

    let review = await createReviewState(input, result.plan, { outboundColumnIds: ['c0'], excludedColumnIds: [] });
    expect(review.cards[1].status).toBe('invalid');
    expect(review.final).toEqual(input);
    expect(review.cards.every((card) => card.decision.approval === undefined)).toBe(true);
    review = await decide(review, { type: 'approve', index: 0, decidedAt: TIME });
    expect(review.cards[1].status).toBe('pending');
    expect(review.cards[1].predecessor.rows).toEqual([['NYC'], ['New York']]);
    expect(review.cards[1].decision.approval).toBeUndefined();
  });
  it('rejects missing names and excluded targets with visible reasons', () => {
    const missing = createTable([{ id: 'c0', name: 'unrelated' }], [['x']]);
    expect(importPlan(serialized, missing).resolution_rejections[0].code).toBe('missing_column');
    const excluded = importPlan(serialized, original, ['c0']);
    expect(excluded.validation.rejected[0].codes).toContain('excluded_column');
  });
  it('uses ordinal only when duplicate-name counts match in both files', () => {
    const a = createTable([{ id: 'c0', name: 'x' }, { id: 'c1', name: 'x' }], [['A', 'B']]);
    const text = exportPlan({ version: 1, steps: [{ ...trim, columns: ['c1'] }] }, a);
    const b = createTable([{ id: 'c0', name: 'x' }, { id: 'c1', name: 'other' }, { id: 'c2', name: 'x' }], [['A', 'Z', 'B']]);
    expect(importPlan(text, b).plan.steps[0].columns).toEqual(['c2']);
    expect(importPlan(text, createTable([{ id: 'c0', name: 'x' }], [['B']])).resolution_rejections[0].code).toBe('ambiguous_column');
    const single = exportPlan({ version: 1, steps: [trim] }, createTable([{ id: 'c0', name: 'x' }], [['A']]));
    expect(importPlan(single, a).resolution_rejections[0].code).toBe('ambiguous_column');
  });
  it('rejects transferred approvals and untrusted human_edited keys', () => {
    expect(() => importPlan(JSON.stringify({ ...JSON.parse(serialized), approvals: [] }), original)).toThrow();
    const text = JSON.stringify({ ...JSON.parse(serialized), steps: [{ ...trim, human_edited: true }] });
    expect(importPlan(text, original).validation.rejected[0].codes).toContain('extra_keys');
  });
});

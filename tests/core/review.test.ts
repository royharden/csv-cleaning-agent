import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/journal/apply.ts';
import { createGenesis, sealEvent, type JournalEvent } from '../../src/core/journal/events.ts';
import { fold } from '../../src/core/journal/fold.ts';
import { approvedPlan, createReviewState, decide } from '../../src/core/review/state.ts';
import { createTable } from '../../src/core/table.ts';
import type { PlanStep } from '../../src/core/transformkit/registry.ts';
import { TIME, approveAll, metaFor, trim } from '../fixtures/m3.ts';

const table = createTable([{ id: 'c0', name: 'amount' }], [[' 12.50 '], [' 42.10 ']]);
const number: PlanStep = { id: 'number', op: 'parse_number', columns: ['c0'], params: { decimal: '.', thousands: 'none', currency: [], parens_negative: false } };
const scope = { outboundColumnIds: ['c0'], excludedColumnIds: [] };

describe('approved-only review', () => {
  it('blocks later approval while an earlier step is pending', async () => {
    const state = await createReviewState(table, { version: 1, steps: [trim, number] }, scope);
    expect(state.cards[1].preview?.counts.unparsed).toBe(2);
    await expect(decide(state, { type: 'approve', index: 1, decidedAt: TIME })).rejects.toThrow('decide step 1 first');
  });
  it('rejecting approved trim recomputes parse and clears stale approval and confirmations', async () => {
    const state = await approveAll(table, [trim, number]);
    const saved = approvedPlan(state);
    const changed = await decide(state, { type: 'reject', index: 0, reason: 'Keep the source padding' });
    expect(changed.cards[1].status).toBe('stale');
    expect(changed.cards[1].preview?.counts.unparsed).toBe(2);
    expect(changed.cards[1].decision.approval).toBeUndefined();
    expect(changed.cards[1].decision.confirmations).toEqual([]);
    expect(() => approvedPlan(changed)).toThrow('decide step 2 first');
    const genesis = await createGenesis(table, metaFor(table), 'stale', TIME);
    await expect(apply(table, [genesis], { ...saved, approvals: saved.approvals.filter((a) => a.step_id === 'number') }, TIME)).rejects.toThrow('predecessor_hash');
    const renewed = await decide(changed, { type: 'approve', index: 1, decidedAt: TIME });
    expect(renewed.cards[1].status).toBe('approved');
    expect((await apply(table, [genesis], approvedPlan(renewed), TIME)).table).toEqual(table);
  });
  it('editing params invalidates approval, then apply rejects the old binding', async () => {
    const state = await approveAll(table, [trim]);
    const genesis = await createGenesis(table, metaFor(table), 'params', TIME);
    const edited = { ...trim, params: { ends: true, collapse_inner: true, nbsp: false, zero_width: false } };
    await expect(apply(table, [genesis], { ...approvedPlan(state), steps: [edited] }, TIME)).rejects.toThrow('params_hash');
    const changed = await decide(state, { type: 'edit', index: 0, step: edited });
    expect(changed.cards[0].status).toBe('pending');
    expect(changed.cards[0].decision.humanEdited).toBe(true);
  });
  it('revalidates observed category values on the actual approved predecessor', async () => {
    const input = createTable([{ id: 'c0', name: 'city' }], [[' NYC '], ['New York']]);
    const map: PlanStep = { id: 'map', op: 'map_categories', columns: ['c0'], params: { groups: [{ from: ['NYC'], to: 'New York' }] } };
    let state = await createReviewState(input, { version: 1, steps: [trim, map] }, scope);
    expect(state.cards[1].status).toBe('invalid');
    state = await decide(state, { type: 'approve', index: 0, decidedAt: TIME });
    expect(state.cards[1].status).toBe('pending');
    state = await decide(state, { type: 'approve', index: 1, decidedAt: TIME });
    const rejected = await decide(state, { type: 'reject', index: 0, reason: 'retain whitespace' });
    expect(rejected.cards[1].status).toBe('invalid');
    expect(rejected.cards[1].decision.approval).toBeUndefined();
  });
  it('human-introduced targets require category guard confirmation again at Apply and fold', async () => {
    const input = createTable([{ id: 'c0', name: 'city' }], [['NYC'], ['New York']]);
    const map: PlanStep = { id: 'map', op: 'map_categories', columns: ['c0'], params: { groups: [{ from: ['NYC'], to: 'New York' }] } };
    let state = await createReviewState(input, { version: 1, steps: [map] }, scope);
    state = await decide(state, { type: 'edit', index: 0, step: { ...map, params: { groups: [{ from: ['NYC'], to: 'New York City' }] } } });
    expect(state.cards[0].status).toBe('unconfirmed');
    await expect(decide(state, { type: 'approve', index: 0, decidedAt: TIME })).rejects.toThrow('category_target');
    state = await decide(state, { type: 'confirm', index: 0, guard: 'category_target' });
    state = await decide(state, { type: 'approve', index: 0, decidedAt: TIME });
    const genesis = await createGenesis(input, metaFor(input), 'human', TIME);
    const plan = approvedPlan(state);
    const result = await apply(input, [genesis], plan, TIME);
    expect(result.table.rows[0]).toEqual(['New York City']);
    const forward = result.events[1]; if (forward.kind !== 'apply') throw new Error('expected apply');
    const unconfirmed = await sealEvent({ ...forward, approval_ref: { ...forward.approval_ref, guard_confirmations: [] } }) as JournalEvent;
    await expect(fold(input, [genesis, unconfirmed])).rejects.toThrow('category_target');
    await expect(apply(input, [genesis], { ...plan, approvals: plan.approvals.map((a) => ({ ...a, guard_confirmations: [] })) }, TIME)).rejects.toThrow('category_target');
    await expect(apply(input, [genesis], { ...plan, approvals: plan.approvals.map((a) => ({ ...a, human_edited: false })) }, TIME)).rejects.toThrow('invented category target');
  });
});

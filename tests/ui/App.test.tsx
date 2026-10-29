// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyBlockReason, type Session } from '../../src/app/controller.ts';
import { hashTable } from '../../src/core/journal/hash.ts';
import { createReviewState, decide } from '../../src/core/review/state.ts';
import { approveAll, TIME, trim } from '../fixtures/m3.ts';
import type { Table } from '../../src/core/table.ts';

const input: Table = { cols: [{ id: 'c0', name: 'Name' }], rows: [[' Alice ']], rid: [0] };
// Only fields consumed by the public gate are material here; storage/rendering are separate checks.
const sessionForGate = (fields: Pick<Session, 'acknowledged' | 'review' | 'outputHash' | 'reviewBaseHash'>): Session => fields as Session;

describe('Apply approval boundary', () => {
  it('requires explicit validation acknowledgement even with recorded approvals', async () => {
    const review = await approveAll(input, [trim]);
    const hash = await hashTable(input);
    expect(applyBlockReason(sessionForGate({ acknowledged: false, review, outputHash: hash, reviewBaseHash: hash })))
      .toMatch(/Acknowledge/);
    expect(applyBlockReason(sessionForGate({ acknowledged: true, review, outputHash: hash, reviewBaseHash: hash })))
      .toBeUndefined();
  });
  it('blocks pending decisions, all-rejected plans and a changed journal predecessor', async () => {
    const review = await createReviewState(input, { version: 1, steps: [trim] }, { outboundColumnIds: ['c0'], excludedColumnIds: [] });
    const hash = await hashTable(input);
    const fields = { acknowledged: true, review, outputHash: hash, reviewBaseHash: hash };
    expect(applyBlockReason(sessionForGate(fields))).toMatch(/decide step/);
    const rejected = await decide(review, { type: 'reject', index: 0, reason: 'Keep padding' });
    expect(applyBlockReason(sessionForGate({ ...fields, review: rejected }))).toMatch(/Approve at least/);
    const approved = await decide(review, { type: 'approve', index: 0, decidedAt: TIME });
    expect(applyBlockReason(sessionForGate({ ...fields, review: approved, outputHash: 'changed' }))).toMatch(/journal state changed/);
  });
});

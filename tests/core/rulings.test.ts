import { describe, expect, it } from 'vitest';
import { createRuling, parseRulings, replayRuling, serializeRulings } from '../../src/core/rulings/rulings.ts';
import { createReviewState, replayRulings } from '../../src/core/review/state.ts';
import { createTable } from '../../src/core/table.ts';
import { TIME, trim } from '../fixtures/m3.ts';

describe('profile-bound rejection rulings', () => {
  const table = createTable([{ id: 'c0', name: 'value' }], [[' A '], ['B']]);
  it('replays a plan_step reason while changed profiles return to review', async () => {
    const ruling = await createRuling(table, trim, 'Whitespace is significant here', TIME);
    expect(ruling.kind).toBe('plan_step');
    const records = parseRulings(serializeRulings([ruling]));
    expect((await replayRuling(table, trim, records))?.reason).toBe('Whitespace is significant here');
    expect(await replayRuling({ ...table, rows: [['different'], ['B']] }, trim, records)).toBeNull();
    expect(await replayRuling(table, { ...trim, params: { ends: true, collapse_inner: true, nbsp: true, zero_width: true } }, records)).toBeNull();
    const state = await createReviewState(table, { version: 1, steps: [trim] }, { outboundColumnIds: ['c0'], excludedColumnIds: [] });
    const replayed = await replayRulings(state, records);
    expect(replayed.cards[0].status).toBe('rejected');
    expect(replayed.cards[0].decision.reason).toBe(ruling.reason);
  });
  it('rejects malformed records rather than treating them as approval authority', () => {
    expect(() => parseRulings('{"kind":"approval"}\n')).toThrow('ruling 0');
  });
});

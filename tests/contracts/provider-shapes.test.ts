import { describe, expect, it } from 'vitest';
import { createTable } from '../../src/core/table.ts';
import { buildLocalProfile } from '../../src/core/profile/profile.ts';
import { buildOutboundProfile } from '../../src/core/profile/outbound.ts';
import { createLlmPlanner, firstJsonObject, proposeRequest } from '../../src/core/planners/llm.ts';
import { judgeRequests } from '../../src/core/planners/jev.ts';
import { ProposePlanRequestSchema } from '../../supabase/functions/propose-plan/contract.ts';
import { JudgeCategoriesRequestSchema } from '../../supabase/functions/judge-categories/contract.ts';
import { parseDirect, directPrompt } from '../../scripts/eval/llm_direct.ts';

describe('browser/edge provider contract equality', () => {
  const table = createTable([{ id: 'c0', name: 'city' }, { id: 'c1', name: 'private' }], [['NYC', 'secret'], ['New York', 'secret'], ['Boston', 'secret']]);
  const local = buildLocalProfile(table); const outbound = buildOutboundProfile(table, local, { excludedColumnIds: ['c1'] }).profile;
  it('sends the exact accepted propose envelope after exclusion', () => {
    const request = proposeRequest(outbound);
    expect(ProposePlanRequestSchema.parse(request)).toEqual(request);
    expect(JSON.stringify(request)).not.toContain('secret');
    expect(ProposePlanRequestSchema.safeParse({ ...request, model: 'client-model' }).success).toBe(false);
  });
  it('sends only disclosed, untruncated pair values accepted by judge contract', () => {
    const requests = judgeRequests(outbound, local); expect(requests).toHaveLength(1);
    expect(JudgeCategoriesRequestSchema.parse(requests[0])).toEqual(requests[0]);
    expect(requests[0].pairs).toHaveLength(3);
  });
  it('accepts colliding truncated browser values without making them Jev candidates', () => {
    const prefix = 'x'.repeat(40);
    const originals = [`${prefix}A`, `${prefix}B`];
    const collisionTable = createTable([{ id: 'c0', name: 'category' }], [...originals, 'NYC', 'New York', 'Boston'].map((value) => [value]));
    const collisionLocal = buildLocalProfile(collisionTable);
    const profile = buildOutboundProfile(collisionTable, collisionLocal, { excludedColumnIds: [] }).profile;
    expect(profile.columns[0].values.filter((entry) => entry.truncated)).toEqual([
      { value: prefix, count: 1, truncated: true },
      { value: prefix, count: 1, truncated: true },
    ]);
    expect(profile.columns[0].values).toHaveLength(5);
    for (const original of originals) expect(JSON.stringify(profile)).not.toContain(original);
    const proposed = proposeRequest(profile);
    expect(ProposePlanRequestSchema.parse(proposed)).toEqual(proposed);
    const requests = judgeRequests(profile, collisionLocal);
    expect(requests).toHaveLength(1);
    const judged = requests[0];
    expect(JudgeCategoriesRequestSchema.parse(judged)).toEqual(judged);
    expect(judged.pairs).toHaveLength(3);
    for (const pair of judged.pairs) expect([pair.a, pair.b, ...pair.siblings]).not.toContain(prefix);
    for (const pair of [
      { ...judged.pairs[0], a: prefix },
      { ...judged.pairs[0], b: prefix },
      { ...judged.pairs[0], siblings: [prefix] },
    ]) expect(JudgeCategoriesRequestSchema.safeParse({ profile, pairs: [pair] }).success).toBe(false);
  });
  it('keeps an observed exact prefix eligible and rejects duplicate exact entries in both contracts', () => {
    const prefix = 'x'.repeat(40);
    const collisionTable = createTable([{ id: 'c0', name: 'category' }], [prefix, `${prefix}A`, `${prefix}B`, 'NYC'].map((value) => [value]));
    const collisionLocal = buildLocalProfile(collisionTable);
    const profile = buildOutboundProfile(collisionTable, collisionLocal, { excludedColumnIds: [] }).profile;
    expect(profile.columns[0].values.filter((entry) => entry.truncated)).toHaveLength(2);
    expect(profile.columns[0].values.filter((entry) => !entry.truncated).map((entry) => entry.value)).toEqual(['NYC', prefix]);
    const proposed = proposeRequest(profile);
    expect(ProposePlanRequestSchema.parse(proposed)).toEqual(proposed);
    const requests = judgeRequests(profile, collisionLocal);
    expect(requests).toHaveLength(1);
    const judged = requests[0];
    expect(judged.pairs).toEqual([{ column: 'c0', a: 'NYC', b: prefix, siblings: [] }]);
    expect(JudgeCategoriesRequestSchema.parse(judged)).toEqual(judged);
    const duplicateExact = { ...profile, columns: profile.columns.map((column) => ({
      ...column, values: [...column.values, { value: prefix, count: 1 }],
    })) };
    expect(ProposePlanRequestSchema.safeParse(proposeRequest(duplicateExact)).success).toBe(false);
    expect(JudgeCategoriesRequestSchema.safeParse({ ...judged, profile: duplicateExact }).success).toBe(false);
  });
  it('parses the first JSON object only, respecting quoted braces', () => {
    expect(firstJsonObject('text {"note":"}\\\"{","x":1} {"x":2}')).toEqual({ note: '}"{', x: 1 });
    expect(() => firstJsonObject('text {broken} {"version":1,"steps":[]}')).toThrow();
  });
  it('makes exactly one call for malformed output and returns a displayed rejection', async () => {
    let calls = 0;
    const result = await createLlmPlanner(table, async () => { calls += 1; return { ok: true, raw: 'not JSON', usage: null,
      provider: 'test', model: 'fixed', request_id: 'request', latency_ms: 1 }; }).plan(outbound, local);
    expect(calls).toBe(1); expect(result.steps).toEqual([]); expect(result.notes?.join(' ')).toMatch(/rejected.*No repair/);
  });
  it('direct-cell schema binds rid and ColumnId and refuses customer data or oversized input', () => {
    expect(() => directPrompt(table, 'customer-data')).toThrow(/synthetic/);
    const raw = JSON.stringify({ version: 1, rows: table.rows.map((row, i) => ({ rid: table.rid[i], cells: row.map((value, c) => ({ column: table.cols[c].id, value })) })) });
    expect(parseDirect(raw, table)).toEqual(table);
    expect(() => parseDirect(raw.replace('"rid":0', '"rid":99'), table)).toThrow(/identity/);
    expect(() => parseDirect(raw.replace('"column":"c0"', '"column":"c9"'), table)).toThrow(/ColumnId/);
  });
});

import { describe, expect, it } from 'vitest';
import { CallLedger } from '../../src/core/ledger/callledger.ts';
import type { PriceTable } from '../../src/core/providers/types.ts';
const prices: PriceTable = { date: '2026-10-24', entries: [{ provider: 'test', model: 'fixed', input_usd_per_million: 1000,
  output_usd_per_million: 1000, max_input_tokens: 1000, max_output_tokens: 1000 }] };
describe('serial worst-case reservation ledger', () => {
  it('reserves before spend, excludes concurrency, and counts actual settled cost', () => {
    const ledger = new CallLedger('run', prices); const a = ledger.reserve('llm', 'test', 'fixed', 'profile');
    expect(ledger.records[0].status).toBe('reserved'); expect(a.reserved_usd).toBe(2);
    expect(() => ledger.reserve('llm', 'test', 'fixed', 'profile')).toThrow(/serially/);
    ledger.settle(a, { raw: { in: 1000, out: 1000 }, input_tokens: 1000, output_tokens: 1000 }, 1);
    const b = ledger.reserve('llm', 'test', 'fixed', 'profile'); ledger.settle(b, { raw: {}, input_tokens: 1000, output_tokens: 1000 }, 1);
    expect(() => ledger.reserve('llm', 'test', 'fixed', 'profile')).toThrow(/5 USD/);
  });
  it('blocks unknown prices without issuing a reservation', () => {
    const ledger = new CallLedger('run', prices);
    expect(() => ledger.reserve('jev', 'unknown', 'moving-alias', 'profile')).toThrow(/Unknown spend/);
    expect(ledger.records).toHaveLength(0);
    expect(ledger.blocked).toBe(true);
  });
  it('records unknown usage as unknown, then blocks every subsequent call', () => {
    const ledger = new CallLedger('run', prices); const reservation = ledger.reserve('llm', 'test', 'fixed', 'profile');
    const row = ledger.settle(reservation, null, 30, 'Network failure after possible billing');
    expect(row.cost_usd).toBeNull(); expect(row.status).toBe('unknown');
    expect(() => ledger.reserve('llm', 'test', 'fixed', 'profile')).toThrow(/stopped/);
  });
  it('stops when actual tokens violate even a zero-priced reservation bound', () => {
    const ledger = new CallLedger('run', prices); const reservation = ledger.reserve('llm', 'test', 'fixed', 'profile');
    ledger.settle(reservation, { raw: {}, input_tokens: 1001, output_tokens: 0 }, 1);
    expect(ledger.blocked).toBe(true);
  });
});

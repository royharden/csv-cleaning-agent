import { describe, expect, it } from 'vitest';
import { liveGate } from '../../src/core/live/gate.ts';
describe('disabled live gate', () => {
  it('requires explicit owner cap attestation, backend and authentication independently', () => {
    expect(liveGate(undefined, true, true).enabled).toBe(false);
    expect(liveGate('0', true, true).reason).toMatch(/hard.*cap/);
    expect(liveGate('1', false, true).reason).toMatch(/Supabase/);
    expect(liveGate('1', true, false).reason).toMatch(/authenticated/);
    expect(liveGate('1', true, true).enabled).toBe(true);
  });
});

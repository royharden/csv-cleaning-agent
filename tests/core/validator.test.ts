/**
 * Plan validator (PLAN.md M2 AC6, AC10; C §5.1 "Validator"). Written in Dirty Mode; not executed yet.
 * bad-model-plan items are asserted by the rejection's step_id (PLAN.md §8 item 3).
 */

import { describe, expect, it } from 'vitest';
import { PLAN_MAX_STEPS, RATIONALE_MAX_CHARS } from '../../src/core/constants.ts';
import { evaluateGuards } from '../../src/core/transformkit/guards.ts';
import { validatePlan, validateStep, type ValidationContext } from '../../src/core/transformkit/validator.ts';
import {
  BAD_MODEL_PLAN_EXCLUDED,
  BAD_MODEL_PLAN_EXPECT,
  BAD_MODEL_PLAN_OUTBOUND,
  BAD_MODEL_PLAN_STEPS,
  BAD_MODEL_PLAN_TABLE,
} from '../fixtures/badModelPlan.ts';
import { allIds, makeTable } from '../fixtures/tables.ts';

const ctx: ValidationContext = {
  table: BAD_MODEL_PLAN_TABLE,
  outboundColumnIds: BAD_MODEL_PLAN_OUTBOUND,
  excludedColumnIds: BAD_MODEL_PLAN_EXCLUDED,
};

const TRIM = { ends: true, collapse_inner: false, nbsp: true, zero_width: true };

function plan(steps: readonly unknown[]): unknown {
  return { version: 1, steps };
}

function rejectionFor(result: ReturnType<typeof validatePlan>, stepId: string) {
  return result.rejected.find((r) => r.step_id === stepId);
}

describe('bad-model-plan items (each rejected with a reason, by step_id)', () => {
  const result = validatePlan(plan(BAD_MODEL_PLAN_STEPS), ctx);

  for (const item of BAD_MODEL_PLAN_EXPECT) {
    it(`rejects ${item.step_id} (${item.code})`, () => {
      const rejected = rejectionFor(result, item.step_id);
      expect(rejected).toBeDefined();
      expect(rejected?.codes).toContain(item.code);
      expect(rejected?.reasons.length).toBeGreaterThan(0);
      expect(rejected?.reasons.every((reason) => reason.length > 0)).toBe(true);
    });
  }

  it('accepts none of them', () => {
    expect(result.accepted).toEqual([]);
    expect(result.rejected.map((r) => r.index)).toEqual([0, 1, 2, 3]);
  });

  it('names both extra keys of bad-extra-keys (step-level and params-level)', () => {
    const rejected = rejectionFor(result, 'bad-extra-keys');
    expect(rejected?.reasons.join(' ')).toContain('confidence');
    expect(rejected?.reasons.join(' ')).toContain('regex');
  });

  it('says the invented target is not observed', () => {
    expect(rejectionFor(result, 'bad-invented-target')?.reasons.join(' ')).toContain('New York City');
  });
});

describe('column references', () => {
  it('rejects an excluded column', () => {
    const r = validatePlan(plan([{ id: 's1', op: 'trim_whitespace', columns: ['c6'], params: TRIM }]), ctx);
    expect(r.rejected[0].codes).toContain('excluded_column');
  });

  it('rejects a display label used as a column reference', () => {
    const r = validatePlan(plan([{ id: 's1', op: 'trim_whitespace', columns: ['city'], params: TRIM }]), ctx);
    expect(r.rejected[0].codes).toEqual(['label_as_column']);
  });

  it('rejects an ambiguous duplicate header used as a label, saying it is ambiguous', () => {
    const table = makeTable(['name', 'name', 'x'], [['a', 'b', 'c']]);
    const r = validatePlan(plan([{ id: 's1', op: 'trim_whitespace', columns: ['name'], params: TRIM }]), {
      table,
      outboundColumnIds: allIds(table),
      excludedColumnIds: [],
    });
    expect(r.rejected[0].codes).toEqual(['label_as_column']);
    expect(r.rejected[0].reasons[0]).toContain('ambiguous');
  });

  it('rejects a column that is not in the outbound list and a repeated column', () => {
    const r1 = validatePlan(plan([{ id: 's1', op: 'trim_whitespace', columns: ['c0'], params: TRIM }]), {
      ...ctx,
      outboundColumnIds: ['c1'],
    });
    expect(r1.rejected[0].codes).toContain('not_outbound');
    const r2 = validatePlan(plan([{ id: 's1', op: 'trim_whitespace', columns: ['c1', 'c1'], params: TRIM }]), ctx);
    expect(r2.rejected[0].codes).toContain('duplicate_column');
  });

  it('rejects wrong arity', () => {
    const r = validatePlan(
      plan([
        { id: 'm', op: 'map_categories', columns: ['c2', 'c3'], params: { groups: [{ from: ['NYC'], to: 'New York' }] } },
        { id: 'd', op: 'drop_duplicate_rows', columns: ['c0'], params: {} },
        { id: 't', op: 'trim_whitespace', columns: [], params: TRIM },
      ]),
      ctx,
    );
    expect(r.rejected.map((x) => x.step_id)).toEqual(['m', 'd', 't']);
    for (const x of r.rejected) expect(x.codes).toContain('arity');
  });
});

describe('step envelope and params', () => {
  it('rejects human_edited in a model or imported plan (step level and params level)', () => {
    const r = validatePlan(
      plan([
        { id: 'a', op: 'trim_whitespace', columns: ['c1'], params: TRIM, human_edited: true },
        { id: 'b', op: 'trim_whitespace', columns: ['c1'], params: { ...TRIM, human_edited: true } },
      ]),
      ctx,
    );
    expect(r.accepted).toEqual([]);
    for (const x of r.rejected) {
      expect(x.codes).toContain('extra_keys');
      expect(x.reasons.join(' ')).toContain('human_edited');
    }
  });

  it('rejects params outside the schema with a reason', () => {
    const r = validatePlan(
      plan([
        { id: 'a', op: 'parse_number', columns: ['c4'], params: { decimal: '.', thousands: '.', currency: [], parens_negative: false } },
        { id: 'b', op: 'standardize_date', columns: ['c5'], params: { from_format: 'D MMM YYYY' } },
        { id: 'c', op: 'null_tokens', columns: ['c3'], params: { tokens: ['NA', 'NA'] } },
        { id: 'd', op: 'normalize_case', columns: ['c1'], params: { mode: 'sentence' } },
        { id: 'e', op: 'trim_whitespace', columns: ['c1'], params: { ...TRIM, ends: false } },
      ]),
      ctx,
    );
    expect(r.rejected.map((x) => x.step_id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    for (const x of r.rejected) expect(x.codes).toContain('params');
  });

  it('rejects duplicate step ids (every step sharing the id)', () => {
    const r = validatePlan(
      plan([
        { id: 'same', op: 'trim_whitespace', columns: ['c1'], params: TRIM },
        { id: 'same', op: 'trim_whitespace', columns: ['c2'], params: TRIM },
        { id: 'other', op: 'trim_whitespace', columns: ['c3'], params: TRIM },
      ]),
      ctx,
    );
    expect(r.rejected.map((x) => x.index)).toEqual([0, 1]);
    for (const x of r.rejected) expect(x.codes).toContain('duplicate_step_id');
    expect(r.accepted.map((a) => a.step.id)).toEqual(['other']);
  });

  it('rejects a rationale over 2,000 characters and accepts exactly 2,000', () => {
    const r = validatePlan(
      plan([
        { id: 'long', op: 'trim_whitespace', columns: ['c1'], params: TRIM, rationale: 'x'.repeat(RATIONALE_MAX_CHARS + 1) },
        { id: 'ok', op: 'trim_whitespace', columns: ['c2'], params: TRIM, rationale: 'x'.repeat(RATIONALE_MAX_CHARS) },
      ]),
      ctx,
    );
    expect(rejectionFor(r, 'long')?.codes).toContain('rationale_too_long');
    expect(r.accepted.map((a) => a.step.id)).toEqual(['ok']);
  });

  it('rejects steps beyond 32 and validates the first 32', () => {
    const steps = Array.from({ length: PLAN_MAX_STEPS + 2 }, (_, i) => ({
      id: `s${i}`,
      op: 'trim_whitespace',
      columns: ['c1'],
      params: TRIM,
    }));
    const r = validatePlan(plan(steps), ctx);
    expect(r.accepted).toHaveLength(PLAN_MAX_STEPS);
    expect(r.rejected.map((x) => x.index)).toEqual([PLAN_MAX_STEPS, PLAN_MAX_STEPS + 1]);
    for (const x of r.rejected) expect(x.codes).toEqual(['too_many_steps']);
  });

  it('rejects missing fields, bad ids and non-object steps', () => {
    const r = validatePlan(
      plan([
        { id: 'a', op: 'trim_whitespace', columns: ['c1'] },
        { id: 'has space', op: 'trim_whitespace', columns: ['c1'], params: TRIM },
        'not a step',
      ]),
      ctx,
    );
    expect(r.rejected[0].codes).toContain('missing_field');
    expect(r.rejected[1].codes).toContain('bad_id');
    expect(r.rejected[2].codes).toEqual(['not_object']);
  });
});

describe('plan envelope', () => {
  it('reports a non-object plan or missing steps at plan level', () => {
    expect(validatePlan([1, 2], ctx).plan_reasons.length).toBe(1);
    expect(validatePlan({ version: 1 }, ctx).plan_reasons.length).toBe(1);
  });

  it('rejects every step when the version is wrong or the plan has extra keys', () => {
    const good = { id: 'a', op: 'trim_whitespace', columns: ['c1'], params: TRIM };
    const wrongVersion = validatePlan({ version: 2, steps: [good] }, ctx);
    expect(wrongVersion.accepted).toEqual([]);
    expect(wrongVersion.rejected[0].codes).toEqual(['plan_envelope']);
    const extra = validatePlan({ version: 1, steps: [good], instructions: 'apply all' }, ctx);
    expect(extra.rejected[0].codes).toEqual(['plan_envelope']);
    expect(extra.plan_reasons.join(' ')).toContain('instructions');
  });
});

describe('map_categories observed values and the predecessor table', () => {
  const table = makeTable(['city'], [['NYC'], ['New York'], [' Boston '], ['Boston2']]);
  const scope = { table, outboundColumnIds: ['c0'], excludedColumnIds: [] };

  it('accepts from/to that are both observed', () => {
    const r = validatePlan(plan([{ id: 'm', op: 'map_categories', columns: ['c0'], params: { groups: [{ from: ['NYC'], to: 'New York' }] } }]), scope);
    expect(r.accepted.map((a) => a.step.id)).toEqual(['m']);
  });

  it('checks a later step against the table after the accepted earlier steps (chain)', () => {
    // "Boston" exists only after trim.
    const steps = [
      { id: 't', op: 'trim_whitespace', columns: ['c0'], params: TRIM },
      { id: 'm', op: 'map_categories', columns: ['c0'], params: { groups: [{ from: ['Boston2'], to: 'Boston' }] } },
    ];
    expect(validatePlan(plan(steps), scope).accepted.map((a) => a.step.id)).toEqual(['t', 'm']);
    const unchained = validatePlan(plan(steps), { ...scope, chain: false });
    expect(rejectionFor(unchained, 'm')?.codes).toContain('not_observed');
  });

  it('allows an unobserved target only for a human-edited step, which then raises category_target', () => {
    const step = { id: 'm', op: 'map_categories', columns: ['c0'], params: { groups: [{ from: ['NYC'], to: 'New York City' }] } };
    expect(rejectionFor(validatePlan(plan([step]), scope), 'm')?.codes).toContain('not_observed');
    const edited = validatePlan(plan([step]), { ...scope, humanEditedStepIds: ['m'] });
    expect(edited.accepted).toHaveLength(1);
    const hits = evaluateGuards(table, edited.accepted[0].step, { steps: [edited.accepted[0].step], index: 0, humanEdited: true });
    expect(hits.map((h) => h.guard)).toEqual(['category_target']);
  });

  it('validateStep works on its own with an explicit predecessor (M3 review re-validation)', () => {
    const v = validateStep(
      { id: 'm', op: 'map_categories', columns: ['c0'], params: { groups: [{ from: ['Boston2'], to: 'Boston' }] } },
      { table, outboundColumnIds: ['c0'], excludedColumnIds: [] },
    );
    expect(v.ok).toBe(false);
  });
});

describe('rename_headers collisions', () => {
  it('rejects a rename whose snake_case collides with another name, listing the names', () => {
    const table = makeTable(['Order ID', 'order_id', 'Name'], [['1', '2', 'x']]);
    const r = validatePlan(plan([{ id: 'r', op: 'rename_headers', columns: ['c0'], params: {} }]), {
      table,
      outboundColumnIds: allIds(table),
      excludedColumnIds: [],
    });
    expect(r.rejected[0].codes).toEqual(['header_collision']);
    expect(r.rejected[0].reasons[0]).toContain('order_id');
  });

  it('rejects a rename to an empty name', () => {
    const table = makeTable(['***', 'b'], [['1', '2']]);
    const r = validatePlan(plan([{ id: 'r', op: 'rename_headers', columns: ['c0'], params: {} }]), {
      table,
      outboundColumnIds: allIds(table),
      excludedColumnIds: [],
    });
    expect(r.rejected[0].codes).toEqual(['header_empty']);
  });
});

/** M3 planner contracts. Test source only: Dirty Mode, no execution yet. */
import { describe, expect, it, vi } from 'vitest';
import { PLAN_MAX_STEPS } from '../../src/core/constants.ts';
import { hashOutboundProfile, loadFixture, validateFixtureRecords } from '../../src/core/planners/fixture.ts';
import { categoryKey, createRulesPlanner, planRules } from '../../src/core/planners/rules.ts';
import { buildLocalProfile } from '../../src/core/profile/profile.ts';
import { buildOutboundProfile } from '../../src/core/profile/outbound.ts';
import { applyStep, type PlanStep } from '../../src/core/transformkit/registry.ts';
import { validatePlan } from '../../src/core/transformkit/validator.ts';
import type { Table } from '../../src/core/table.ts';
import { columnTable, makeTable } from '../fixtures/tables.ts';

function profiles(table: Table, excluded: readonly string[] = []) {
  const local = buildLocalProfile(table);
  const outbound = buildOutboundProfile(table, local, { excludedColumnIds: excluded });
  return { local, outbound };
}

function propose(table: Table, excluded: readonly string[] = []) {
  const { local, outbound } = profiles(table, excluded);
  return planRules(outbound.profile, local, table);
}

function execute(table: Table, steps: readonly PlanStep[]): Table {
  return steps.reduce((current, step) => applyStep(current, step).table, table);
}

describe('offline deterministic rules planner', () => {
  it('trims before interpreting padded amounts, renames headers and drops exact duplicates last', () => {
    const table = makeTable(['Order ID', 'Amount'], [['001', ' $1,204.50 '], ['002', ' $2,345.60 '], ['001', '$1,204.50']]);
    const result = propose(table);
    expect(result.steps[0].op).toBe('trim_whitespace');
    expect(result.steps.map((step) => step.op)).toContain('rename_headers');
    expect(result.steps.find((step) => step.op === 'parse_number')?.columns).toEqual(['c1']);
    expect(result.steps.at(-1)?.op).toBe('drop_duplicate_rows');
    expect(execute(table, result.steps).rows).toEqual([['001', '1204.50'], ['002', '2345.60']]);
    expect(propose(table)).toEqual(result);
    expect(table.rows[0][1]).toBe(' $1,204.50 ');
  });

  it('leaves all four named traps untouched: leading-zero-id, NA country, near duplicates and mixed-case names', () => {
    const table = makeTable(['id', 'country', 'name'], [
      ['001', 'NA', 'McDonald'], ['002', 'US', 'McDonalds'], ['003', 'DE', 'iPhone'], ['004', 'GB', 'van Gogh'],
    ]);
    const result = propose(table);
    expect(result.steps).toEqual([]);
    expect(execute(table, result.steps)).toEqual(table);
  });

  it('never invents alias equivalence, approximate duplicate rows or title-casing', () => {
    const table = columnTable('city', ['NYC', 'New York', 'New Yorkk']);
    expect(propose(table).steps).toEqual([]);
    expect(categoryKey('New York')).not.toBe(categoryKey('Newyork'));
  });

  it('uses the whole local vocabulary beyond the eight outbound values, with observed frequency/lexical targets', () => {
    const values = Array.from({ length: 10 }, (_, i) => `Region ${i}`);
    const table = columnTable('region', [...values, 'west', 'WEST', 'west']);
    const { local, outbound } = profiles(table);
    expect(outbound.profile.columns[0].values.length).toBe(8);
    const result = planRules(outbound.profile, local, table);
    const map = result.steps.find((step) => step.op === 'map_categories');
    expect(map?.params).toEqual({ groups: [{ from: ['WEST'], to: 'west' }] });
    const tie = propose(columnTable('city', ['new york', 'New York']));
    expect(tie.steps[0].params).toEqual({ groups: [{ from: ['new york'], to: 'New York' }] });
  });

  it('uses category values after trim, so every mapping member is observed at its predecessor', () => {
    const table = columnTable('city', [' new york ', 'New York', 'New York']);
    const result = propose(table);
    let predecessor = table;
    for (const step of result.steps) {
      const validation = validatePlan({ version: 1, steps: [step] }, {
        table: predecessor, outboundColumnIds: ['c0'], excludedColumnIds: [],
      });
      expect(validation.rejected).toEqual([]);
      predecessor = applyStep(predecessor, step).table;
    }
    expect(predecessor.rows).toEqual([['New York']]);
  });

  it('excludes per-column transformations while preserving whole-record deduplication semantics', () => {
    const table = makeTable(['city', 'Private Notes'], [[' new york ', ' 007 '], ['New York', '008']]);
    const result = propose(table, ['c1']);
    expect(result.steps.every((step) => !step.columns.includes('c1'))).toBe(true);
    expect(execute(table, result.steps).rows.map((row) => row[1])).toEqual([' 007 ', '008']);
  });

  it('rejects ambiguous or contradictory dates and unproven numeric separators, allowing proven dates', () => {
    for (const values of [['03/04/2023', '04/05/2023'], ['25/01/2023', '01/25/2023'], ['1,234', '2,345'], ['1,234', '1.234']]) {
      const result = propose(columnTable('value', values));
      expect(result.steps.some((step) => step.op === 'standardize_date' || step.op === 'parse_number' || step.op === 'map_categories')).toBe(false);
    }
    const dates = propose(columnTable('date', ['25/12/2023', '03/04/2023']));
    expect(dates.steps.find((step) => step.op === 'standardize_date')?.params).toEqual({ from_format: 'DD/MM/YYYY' });
  });

  it('does not count malformed numeric grammar as proof and catches currency-prefixed leading zeros', () => {
    const malformed = columnTable('amount', [...Array.from({ length: 19 }, () => '1,234'), '1,23.45']);
    expect(propose(malformed).steps.some((step) => step.op === 'parse_number')).toBe(false);
    expect(propose(columnTable('amount', ['$001.25', '$002.50'])).steps.some((step) => step.op === 'parse_number')).toBe(false);
  });

  it('profiles high-cardinality padded amounts using the bound adapter; profile-only mode reports missing evidence', async () => {
    const table = columnTable('amount', Array.from({ length: 70 }, (_, i) => ` $${i + 100}.25 `));
    const { local, outbound } = profiles(table);
    const result = await createRulesPlanner(table).plan(outbound.profile, local);
    expect(result.steps).toEqual(propose(table).steps);
    expect(propose(table).steps.some((step) => step.op === 'parse_number')).toBe(true);
    expect(planRules(outbound.profile, local).notes.join(' ')).toContain('full values unavailable');
    expect(planRules(outbound.profile, local).steps.some((step) => step.op === 'parse_number')).toBe(false);
  });

  it('bounds review cards and leaves a rename collision as an explicit note', () => {
    const table = makeTable(Array.from({ length: 40 }, (_, i) => `column_${i}`),
      [Array.from({ length: 40 }, () => '$12.50'), Array.from({ length: 40 }, () => '$13.25')]);
    expect(propose(table).steps.length).toBeLessThanOrEqual(PLAN_MAX_STEPS);
    expect(propose(table).notes.join(' ')).toContain('Plan limit');
    const collision = propose(makeTable(['City Name', 'city_name'], [['a', 'b']]));
    expect(collision.steps.some((step) => step.op === 'rename_headers')).toBe(false);
    expect(collision.notes.join(' ')).toContain('Headers left untouched');
  });
});

const keyA = 'a'.repeat(64);
const keyB = 'b'.repeat(64);
const llmFixture = (hash = keyA) => ({ fixture_id: 'demo-llm', planner: 'llm', source: 'synthetic-fixture',
  source_csv: 'fixtures/demo/orders-demo.csv', excluded_column_ids: ['c2'], profile_hash: hash,
  steps: [{ id: 'bad-unknown-op', op: 'invented', columns: ['c0'], params: {} }] });
const jevFixture = () => ({ fixture_id: 'demo-jev', planner: 'jev', source: 'synthetic-fixture',
  source_csv: 'fixtures/demo/orders-demo.csv', excluded_column_ids: ['c2'], profile_hash: keyA,
  pairs: [{ column: 'c0', pairs: [{ a: 'NYC', b: 'New York', score: 0.95 }] }], threshold: 0.9 });

describe('pure fixture lookup and profile identity', () => {
  it('resolves by planner AND outbound hash, preserving synthetic/adversarial payloads without network', () => {
    const network = vi.fn(() => { throw new Error('offline'); });
    vi.stubGlobal('fetch', network);
    try {
      expect(loadFixture([llmFixture(), jevFixture()], 'llm', keyA)).toMatchObject({ source: 'synthetic-fixture', steps: llmFixture().steps });
      expect(loadFixture([llmFixture(), jevFixture()], 'jev', keyA)).toMatchObject({ pairs: jevFixture().pairs, threshold: 0.9 });
      expect(network).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('never matches PENDING and gives a rekey command; duplicate keys are a load error', () => {
    expect(() => loadFixture([llmFixture('PENDING')], 'llm', 'PENDING')).toThrow('npm run fixtures:rekey');
    expect(() => loadFixture([llmFixture('PENDING')], 'llm', keyA)).toThrow('not yet keyed');
    expect(() => loadFixture([llmFixture(), { ...llmFixture(), fixture_id: 'duplicate' }], 'llm', keyA)).toThrow('Duplicate fixture key');
    expect(() => validateFixtureRecords([llmFixture('PENDING'), llmFixture('PENDING')])).toThrow('Duplicate fixture key');
  });

  it('fails actionably on hash miss, wrong planner, missing threshold and malformed records', () => {
    expect(() => loadFixture([llmFixture()], 'llm', keyB)).toThrow('No llm fixture');
    expect(() => loadFixture([llmFixture()], 'jev', keyA)).toThrow('No jev fixture');
    const withoutThreshold = { ...jevFixture(), threshold: undefined };
    expect(() => loadFixture([withoutThreshold], 'jev', keyA)).toThrow('no synthetic replay threshold');
    expect(() => loadFixture([{ ...llmFixture(), extra: true }], 'llm', keyA)).toThrow('Repair the fixture envelope');
    expect(() => loadFixture([{ ...llmFixture(), excluded_column_ids: ['c2', 'c2'] }], 'llm', keyA)).toThrow('list each ColumnId once');
  });

  it('keys source CSV content after exclusions, with stable canonical hash shared by browser and rekey CLI', async () => {
    const table = makeTable(['city', 'notes'], [['New York', 'private original']]);
    const altered = makeTable(['city', 'notes'], [['New York', 'private changed']]);
    const included = makeTable(['city', 'notes'], [['NYC', 'private original']]);
    const first = profiles(table, ['c1']);
    const hash = await hashOutboundProfile(first.outbound.profile);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashOutboundProfile(profiles(altered, ['c1']).outbound.profile)).toBe(hash);
    expect(await hashOutboundProfile(profiles(included, ['c1']).outbound.profile)).not.toBe(hash);
    expect(await hashOutboundProfile(profiles(table).outbound.profile)).not.toBe(hash);
  });
});

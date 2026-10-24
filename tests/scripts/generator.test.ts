import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import llmDemo from '../../fixtures/plans/demo.llm.json';
import jevDemo from '../../fixtures/plans/demo.jev.json';
import thresholds from '../../fixtures/jev-thresholds.json';
import { generateAllDatasets, generateDataset, loadSeededFixtures, writeSeededFixtures } from '../../scripts/seededdirty/generator.ts';
import { DEV_SEEDS, FAMILIES, HELDOUT_SEEDS } from '../../scripts/seededdirty/manifest.ts';
import { REQUIRED_TRAPS } from '../../scripts/seededdirty/traps.ts';
import { validateFixtureRecords } from '../../src/core/planners/fixture.ts';
import { BAD_MODEL_PLAN_STEPS } from '../fixtures/badModelPlan.ts';

describe('seededdirty contract (test source; execution deferred)', () => {
  it('repeats a seed exactly and declares disjoint dev/held-out populations', () => {
    expect(generateDataset('orders', 101)).toEqual(generateDataset('orders', 101));
    const datasets = generateAllDatasets();
    expect(datasets).toHaveLength(24);
    expect(new Set(datasets.map((dataset) => dataset.id)).size).toBe(24);
    for (const family of FAMILIES) {
      expect(datasets.filter((dataset) => dataset.family === family && dataset.split === 'dev').map((dataset) => dataset.seed)).toEqual(DEV_SEEDS);
      expect(datasets.filter((dataset) => dataset.family === family && dataset.split === 'heldout').map((dataset) => dataset.seed)).toEqual(HELDOUT_SEEDS);
    }
    expect(() => generateDataset('orders', 900)).toThrow(/never generated/);
    for (const dataset of datasets) {
      expect(dataset.dirty.rows.length).toBeGreaterThanOrEqual(300);
      expect(dataset.dirty.rows.length).toBeLessThanOrEqual(1000);
    }
  });

  it('plants every named trap, labels each changed coordinate, and preserves duplicate lineage', () => {
    for (const family of FAMILIES) {
      const dataset = generateDataset(family, 1, 300);
      const names = new Set(dataset.labels.traps.map((trap) => trap.name));
      for (const name of REQUIRED_TRAPS) expect(names.has(name), `${family}/${name}`).toBe(true);
      const labels = new Map(dataset.labels.cells.map((cell) => [`${cell.rid}/${cell.column}`, cell]));
      expect(labels.size).toBe(dataset.labels.cells.length);
      for (const entry of dataset.row_map) {
        const dirtyIndex = dataset.dirty.rid.indexOf(entry.rid);
        const cleanIndex = dataset.clean.rid.indexOf(entry.clean_rid);
        expect(cleanIndex).toBeGreaterThanOrEqual(0);
        dataset.dirty.rows[dirtyIndex].forEach((dirty, column) => {
          const clean = dataset.clean.rows[cleanIndex][column];
          const label = labels.get(`${entry.rid}/c${column}`);
          if (dirty !== clean) {
            expect(label).toMatchObject({ dirty, clean });
            if (label?.label === 'fixable_by') expect(label.fixable_by).toBeDefined();
            else expect(label?.label).toBe('out_of_scope');
          } else expect(label).toBeUndefined();
        });
      }
      expect(dataset.labels.duplicates).toHaveLength(2);
      for (const duplicate of dataset.labels.duplicates) {
        expect(dataset.clean.rid).not.toContain(duplicate.rid);
        expect(dataset.row_map.find((entry) => entry.rid === duplicate.rid)).toEqual({
          rid: duplicate.rid, clean_rid: duplicate.retained_rid, duplicate: true,
        });
      }
    }
  });

  it('writes stable artifact hashes and reloads the encoded corpus with rid identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 's23-seeded-'));
    try {
      const first = await writeSeededFixtures(root, '2026-01-01');
      const second = await writeSeededFixtures(root, '2026-01-01');
      expect(second).toEqual(first);
      expect(first.freeze_date).toBe('2026-01-01');
      expect(first.files.every((file) => Object.values(file.sha256).every((hash) => /^[0-9a-f]{64}$/.test(hash)))).toBe(true);
      expect(await loadSeededFixtures(root)).toEqual(generateAllDatasets());
      const path = join(root, first.files[0].paths.dirty);
      const bytes = await readFile(path);
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path, new Uint8Array([...bytes, 32]));
      await expect(loadSeededFixtures(root)).rejects.toThrow(/size\/hash mismatch/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('keeps demo envelopes compatible with the pure fixture schema and live thresholds unfrozen', () => {
    expect(validateFixtureRecords([llmDemo, jevDemo])).toHaveLength(2);
    expect(llmDemo.profile_hash).toBe('PENDING');
    expect(jevDemo.profile_hash).toBe('PENDING');
    expect(llmDemo.excluded_column_ids).toEqual(['c6']);
    expect(jevDemo.source).toBe('synthetic-fixture');
    expect(jevDemo.threshold).toBeGreaterThan(0);
    expect(thresholds.status).toBe('not yet frozen');
    expect(thresholds.threshold).toBeNull();
    // M2's table predates the actual M4 demo column order. Only ColumnIds are remapped.
    const map: Readonly<Record<string, string>> = { c2: 'c5', c3: 'c4', c4: 'c2', c5: 'c3' };
    const bad = BAD_MODEL_PLAN_STEPS.map((step) => ({ ...step,
      columns: (step.columns as readonly string[]).map((column) => map[column] ?? column) }));
    expect(llmDemo.steps.slice(0, 4)).toEqual(bad);
    expect(llmDemo.steps.map((step) => step.op)).toEqual([
      'trim_whitespace', 'fix_everything', 'null_tokens', 'map_categories', 'rename_headers',
      'drop_duplicate_rows', 'trim_whitespace', 'parse_number', 'null_tokens',
      'standardize_date', 'map_categories', 'drop_duplicate_rows',
    ]);
  });
});

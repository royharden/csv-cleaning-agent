/**
 * Rekey fixtures from actual source CSV bytes and each record's exclusions (PLAN.md row 25).
 * Written in Dirty Mode; DO NOT RUN until dependency installation/execution is authorized.
 * Validates and computes EVERY replacement before writing any file. Synthetic provenance is preserved.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBytes } from '../src/core/csv/parse.ts';
import { hashOutboundProfile, validateFixtureRecords } from '../src/core/planners/fixture.ts';
import { buildLocalProfile } from '../src/core/profile/profile.ts';
import { buildOutboundProfile } from '../src/core/profile/outbound.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function withinRoot(path: string): string {
  const absolute = resolve(root, path);
  const suffix = relative(root, absolute);
  if (isAbsolute(path) || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
    throw new Error(`source_csv must be a relative path within this product repo: ${path}`);
  }
  return absolute;
}

async function main(): Promise<void> {
  const directory = resolve(root, 'fixtures/plans');
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (entries.length === 0) throw new Error('No fixtures in fixtures/plans. Add source_csv/excluded_column_ids fixture records first.');
  // Parse individually first: old keys may collide and rekeying is precisely how stale keys get repaired.
  const pending: { path: string; record: ReturnType<typeof validateFixtureRecords>[number] }[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
    const [record] = validateFixtureRecords([raw]);
    const input = await readFile(withinRoot(record.source_csv));
    const parsed = parseBytes(input);
    if (!parsed.ok) throw new Error(`${entry.name}: cannot parse ${record.source_csv}: ${parsed.error.message}`);
    const ids = new Set(parsed.table.cols.map((column) => column.id));
    for (const id of record.excluded_column_ids) {
      if (!ids.has(id)) throw new Error(`${entry.name}: excluded ColumnId ${id} is absent from ${record.source_csv}; fix the fixture identity.`);
    }
    const local = buildLocalProfile(parsed.table);
    const outbound = buildOutboundProfile(parsed.table, local, { excludedColumnIds: record.excluded_column_ids });
    if (!outbound.fits) throw new Error(`${entry.name}: outbound profile exceeds the disclosure byte cap; cannot key this fixture.`);
    pending.push({ path, record: { ...record, profile_hash: await hashOutboundProfile(outbound.profile) } });
  }
  // New duplicate lookup keys abort before any file is changed; no "last fixture wins".
  validateFixtureRecords(pending.map(({ record }) => record));
  for (const { path, record } of pending) {
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    console.log(`${relative(root, path)}: ${record.planner} ${record.profile_hash}`);
  }
}

main().catch((error: unknown) => {
  console.error(`fixtures:rekey: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

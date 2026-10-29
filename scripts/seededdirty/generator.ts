import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseBytes } from '../../src/core/csv/parse.ts';
import { serializeTable } from '../../src/core/csv/serialize.ts';
import { createTable, type Table } from '../../src/core/table.ts';
import { injectCell, type InjectionState } from './inject.ts';
import { DEV_SEEDS, FAMILIES, GENERATOR_VERSION, HELDOUT_SEEDS,
  type ArtifactKind, type Family, type FixtureFormat, type ManifestFile, type SeededDataset,
  type SeededManifest, type Split } from './manifest.ts';
import { plantTraps } from './traps.ts';
import { choose, CITIES, COUNTRIES, createPrng, FAMILY_NAMES, GIVEN_NAMES, PRODUCTS, STATUSES } from './wordlists.ts';

export const DEFAULT_SEEDED_ROOT = fileURLToPath(new URL('../../fixtures/seeded/', import.meta.url));

function splitFor(seed: number): Split {
  if ((DEV_SEEDS as readonly number[]).includes(seed)) return 'dev';
  if ((HELDOUT_SEEDS as readonly number[]).includes(seed)) return 'heldout';
  throw new Error('Seed must be dev 1–4 or held-out 101–104; the hand-authored demo is never generated.');
}

export function formatFor(seed: number): FixtureFormat {
  const variant = seed % 100;
  return { encoding: variant === 3 ? 'windows-1252' : 'utf-8', delimiter: variant === 2 || variant === 3 ? ';' : ',',
    terminator: variant === 1 || variant === 3 ? '\r\n' : '\n', bom: variant === 1 };
}

/** Pure generation. rowCount includes the two appended duplicate records. */
export function generateDataset(family: Family, seed: number, rowCount?: number): SeededDataset {
  if (!(FAMILIES as readonly string[]).includes(family)) throw new Error(`Unknown family ${family}`);
  const split = splitFor(seed);
  const familyIndex = FAMILIES.indexOf(family);
  const random = createPrng((seed * 65537 + familyIndex * 104729) >>> 0);
  const count = rowCount ?? 300 + Math.floor(random() * 701);
  if (!Number.isInteger(count) || count < 300 || count > 1000) throw new Error('Expected 300–1,000 dirty rows.');
  const headers = [family === 'customers' ? 'customer_id' : family === 'orders' ? 'order_id' : 'sku',
    family === 'inventory' ? 'product_name' : 'customer_name', family === 'inventory' ? 'unit_price' : 'amount',
    family === 'customers' ? 'signup_date' : family === 'orders' ? 'order_date' : 'restock_date',
    'country', 'city', 'status', 'notes', 'email', 'region', 'region_detail', 'source_note'];
  const rows: string[][] = [];
  for (let rid = 0; rid < count - 2; rid += 1) {
    const name = `${choose(GIVEN_NAMES, random)} ${choose(FAMILY_NAMES, random)}`;
    const whole = 10 + Math.floor(random() * 9000);
    const cents = String(Math.floor(random() * 100)).padStart(2, '0');
    rows.push([String(rid + 1).padStart(5, '0'), family === 'inventory' ? choose(PRODUCTS, random) : name,
      `${whole}.${cents}`, `2024-05-${String(1 + rid % 28).padStart(2, '0')}`, choose(COUNTRIES, random),
      choose(CITIES, random), choose(STATUSES, random), 'shipped carefully', `synthetic-${seed}-${rid}@example.com`,
      rid % 2 === 0 ? 'IL' : 'MA', family, 'synthetic record']);
  }
  const state: InjectionState = { clean: rows.map((row) => row.slice()), dirty: rows.map((row) => row.slice()),
    clean_headers: headers.slice(), dirty_headers: headers.slice(), cells: [], headers: [], duplicates: [], traps: [],
    row_map: rows.map((_, rid) => ({ rid, clean_rid: rid, duplicate: false })) };
  // Every family gets ordinary errors as well as the fixed adversarial stratum.
  for (let rid = 64; rid < rows.length; rid += 1) {
    const draw = random();
    if (draw < 0.16) injectCell(state, rid, 1, `  ${rows[rid][1]}  `, 'padded-text', 'trim_whitespace');
    else if (draw < 0.28) injectCell(state, rid, 2, `$${rows[rid][2]}`, 'currency-amount', 'parse_number');
    else if (draw < 0.36) injectCell(state, rid, 6, rows[rid][6].toUpperCase(), 'status-case', 'normalize_case', 'case');
    else if (draw < 0.42) injectCell(state, rid, 7, 'shippd carefully', 'free-text-typo');
    else if (draw < 0.48) {
      state.clean[rid][7] = '';
      state.dirty[rid][7] = '';
      injectCell(state, rid, 7, '(blank)', 'null-token', 'null_tokens');
    }
  }
  plantTraps(state);
  [0, 1].forEach((column) => {
    const dirty = state.clean_headers[column].split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
    state.dirty_headers[column] = dirty;
    state.headers.push({ column: `c${column}`, dirty, clean: state.clean_headers[column], label: 'fixable_by',
      fixable_by: 'rename_headers', trap: 'header-style' });
  });
  const cols = (names: readonly string[]) => names.map((name, index) => ({ id: `c${index}`, name }));
  return { id: `${family}-${seed}`, family, seed, split,
    dirty: createTable(cols(state.dirty_headers), state.dirty, state.row_map.map((entry) => entry.rid)),
    clean: createTable(cols(state.clean_headers), state.clean),
    labels: { cells: state.cells, headers: state.headers, duplicates: state.duplicates, traps: state.traps },
    row_map: state.row_map };
}

export function generateAllDatasets(): SeededDataset[] {
  return FAMILIES.flatMap((family) => [...DEV_SEEDS, ...HELDOUT_SEEDS].map((seed) => generateDataset(family, seed)));
}

function csvBytes(table: Table, format: FixtureFormat): Uint8Array {
  const text = serializeTable(table, { ...format, trailing_terminator: true });
  if (format.encoding === 'windows-1252') {
    const bytes: number[] = [];
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      if (code > 255 || (code >= 128 && code < 160)) throw new Error('Synthetic windows-1252 text contains unsupported characters.');
      bytes.push(code);
    }
    return Uint8Array.from(bytes);
  }
  return new TextEncoder().encode((format.bom ? '\ufeff' : '') + text);
}
function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function jsonBytes(value: unknown): Uint8Array { return new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n'); }

/** Explicit IO entrypoint. Importing this module never generates files. */
export async function writeSeededFixtures(root = DEFAULT_SEEDED_ROOT, freezeDate?: string): Promise<SeededManifest> {
  if (freezeDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(freezeDate)) throw new Error('freezeDate must be YYYY-MM-DD.');
  const files: ManifestFile[] = [];
  for (const dataset of generateAllDatasets()) {
    const format = formatFor(dataset.seed);
    const paths = { dirty: `${dataset.split}/dirty/${dataset.id}.csv`, clean: `${dataset.split}/clean/${dataset.id}.csv`,
      labels: `${dataset.split}/labels/${dataset.id}.json` };
    const artifacts = { dirty: csvBytes(dataset.dirty, format), clean: csvBytes(dataset.clean, format),
      labels: jsonBytes({ id: dataset.id, family: dataset.family, split: dataset.split, seed: dataset.seed,
        row_map: dataset.row_map, labels: dataset.labels }) };
    for (const kind of ['dirty', 'clean', 'labels'] as const) {
      const path = resolve(root, paths[kind]);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, artifacts[kind]);
    }
    files.push({ id: dataset.id, family: dataset.family, split: dataset.split, seed: dataset.seed,
      rows: { dirty: dataset.dirty.rows.length, clean: dataset.clean.rows.length }, columns: dataset.dirty.cols.length,
      paths, sha256: { dirty: sha256(artifacts.dirty), clean: sha256(artifacts.clean), labels: sha256(artifacts.labels) },
      bytes: { dirty: artifacts.dirty.length, clean: artifacts.clean.length, labels: artifacts.labels.length },
      row_map: dataset.row_map, format });
  }
  const manifest: SeededManifest = { generator_version: GENERATOR_VERSION,
    seeds: { dev: [...DEV_SEEDS], heldout: [...HELDOUT_SEEDS] }, freeze_date: freezeDate ?? null, files };
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, 'MANIFEST.json'), jsonBytes(manifest));
  return manifest;
}

function artifactPath(root: string, path: string): string {
  const target = resolve(root, path);
  const rel = relative(resolve(root), target);
  if (isAbsolute(path) || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Manifest artifact path escapes fixture root.');
  return target;
}

/** Reject edited bytes, wrong generator version, changed labels or damaged rid lineage. */
export async function loadSeededFixtures(root = DEFAULT_SEEDED_ROOT): Promise<SeededDataset[]> {
  const manifest = JSON.parse(await readFile(resolve(root, 'MANIFEST.json'), 'utf8')) as SeededManifest;
  if (manifest.generator_version !== GENERATOR_VERSION || !Array.isArray(manifest.files) || manifest.files.length !== 24 ||
    JSON.stringify(manifest.seeds) !== JSON.stringify({ dev: DEV_SEEDS, heldout: HELDOUT_SEEDS })) {
    throw new Error('Seeded MANIFEST does not describe this generator and the declared 24-file population. Regenerate explicitly.');
  }
  const ids = new Set<string>();
  const datasets: SeededDataset[] = [];
  for (const entry of manifest.files) {
    if (!(FAMILIES as readonly string[]).includes(entry.family) || entry.split !== splitFor(entry.seed) ||
      entry.id !== `${entry.family}-${entry.seed}` || ids.has(entry.id)) throw new Error('Invalid/repeated manifest dataset identity.');
    ids.add(entry.id);
    const artifacts = {} as Record<ArtifactKind, Uint8Array>;
    for (const kind of ['dirty', 'clean', 'labels'] as const) {
      const bytes = await readFile(artifactPath(root, entry.paths[kind]));
      if (bytes.length !== entry.bytes[kind] || sha256(bytes) !== entry.sha256[kind]) throw new Error(`${entry.id}/${kind}: manifest size/hash mismatch.`);
      artifacts[kind] = bytes;
    }
    const dirtyResult = parseBytes(artifacts.dirty);
    const cleanResult = parseBytes(artifacts.clean);
    if (!dirtyResult.ok || !cleanResult.ok) throw new Error(`${entry.id}: generated CSV did not parse.`);
    const record = JSON.parse(new TextDecoder().decode(artifacts.labels)) as Omit<SeededDataset, 'dirty' | 'clean'>;
    if (record.id !== entry.id || record.family !== entry.family || record.seed !== entry.seed || record.split !== entry.split ||
      JSON.stringify(record.row_map) !== JSON.stringify(entry.row_map)) throw new Error(`${entry.id}: labels/manifest lineage mismatch.`);
    const cleanRids = entry.row_map.filter((row) => !row.duplicate).map((row) => row.clean_rid);
    const dirty = createTable(dirtyResult.table.cols, dirtyResult.table.rows, entry.row_map.map((row) => row.rid));
    const clean = createTable(cleanResult.table.cols, cleanResult.table.rows, cleanRids);
    if (dirty.rows.length !== entry.rows.dirty || clean.rows.length !== entry.rows.clean || dirty.cols.length !== entry.columns ||
      clean.cols.length !== entry.columns || dirty.rows.length < 300 || dirty.rows.length > 1000) throw new Error(`${entry.id}: manifest table dimensions mismatch.`);
    const cleanIndex = new Map(clean.rid.map((rid, index) => [rid, index]));
    const dirtyIndex = new Map(dirty.rid.map((rid, index) => [rid, index]));
    const rowMap = new Map(entry.row_map.map((row) => [row.rid, row]));
    const seenCells = new Set<string>();
    for (const cell of record.labels.cells) {
      const row = rowMap.get(cell.rid);
      const d = dirtyIndex.get(cell.rid);
      const c = row === undefined ? undefined : cleanIndex.get(row.clean_rid);
      const column = dirty.cols.findIndex((col) => col.id === cell.column);
      const key = `${cell.rid}/${cell.column}`;
      if (d === undefined || c === undefined || column < 0 || cell.dirty !== dirty.rows[d][column] || cell.clean !== clean.rows[c][column] ||
        cell.dirty === cell.clean || seenCells.has(key) || (cell.label !== 'fixable_by' && cell.label !== 'out_of_scope') ||
        (cell.label === 'fixable_by' && cell.fixable_by === undefined)) throw new Error(`${entry.id}: invalid cell label ${key}.`);
      seenCells.add(key);
    }
    for (const row of entry.row_map) if (!cleanIndex.has(row.clean_rid)) throw new Error(`${entry.id}: missing clean row lineage.`);
    for (const duplicate of record.labels.duplicates) {
      const row = rowMap.get(duplicate.rid);
      if (row === undefined || !row.duplicate || row.clean_rid !== duplicate.retained_rid) throw new Error(`${entry.id}: invalid duplicate lineage.`);
    }
    datasets.push({ ...record, dirty, clean });
  }
  return datasets;
}

const invoked = process.argv[1];
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--freeze-date')) {
    console.error('Usage: npm run seed -- [--freeze-date YYYY-MM-DD]');
    process.exitCode = 1;
  } else {
    writeSeededFixtures(DEFAULT_SEEDED_ROOT, args[1]).then((manifest) => {
      console.log(`Wrote ${manifest.files.length} seeded datasets; freeze date: ${manifest.freeze_date ?? 'not yet frozen'}.`);
    }).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
  }
}

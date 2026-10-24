/** Evaluation orchestration. Importing is inert; CLI execution is explicitly guarded below. */
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PLAN_MAX_STEPS, REVIEW_SAMPLE_ROWS } from '../../src/core/constants.ts';
import type { ParseMeta } from '../../src/core/csv/parse.ts';
import { apply } from '../../src/core/journal/apply.ts';
import { createGenesis } from '../../src/core/journal/events.ts';
import { hashTable } from '../../src/core/journal/hash.ts';
import { invariant } from '../../src/core/journal/invariant.ts';
import { undoAll } from '../../src/core/journal/undo.ts';
import { createApproval, type Approval } from '../../src/core/review/approvals.ts';
import { buildLocalProfile } from '../../src/core/profile/profile.ts';
import { buildOutboundProfile } from '../../src/core/profile/outbound.ts';
import { evaluateGuards, type GuardHit } from '../../src/core/transformkit/guards.ts';
import { previewOne, type PlanStep } from '../../src/core/transformkit/registry.ts';
import { validateStep } from '../../src/core/transformkit/validator.ts';
import type { Table } from '../../src/core/table.ts';
import { loadSeededFixtures, writeSeededFixtures } from '../seededdirty/generator.ts';
import { GENERATOR_VERSION, type SeededDataset } from '../seededdirty/manifest.ts';
import { GUARDED_TRAPS } from '../seededdirty/traps.ts';
import { METHODS, type EvalMethod, type MeasurementMeta, type MethodId } from './methods.ts';
import { oracleDecision, type ReviewMode } from './oracle.ts';
import { newlyFixed } from './oracle.ts';
import { rate, scoreDataset, type Score } from './scorer.ts';
import { matchedSubset, selectSubsetColumns, type SubsetSelection } from './subset.ts';
import { renderReport } from './report.ts';
import { updateLimitations } from './limitations.ts';
export type Population = 'full' | 'matched-200x6';
export interface StepDecision {
  readonly step_id: string; readonly status: 'applied' | 'rejected' | 'guard-blocked' | 'oracle-rejected';
  readonly reasons: readonly string[]; readonly guards: readonly GuardHit[]; readonly traps: readonly string[];
  readonly samples_shown: number; readonly beneficial: boolean;
}
export interface PlanMeasurement {
  readonly output: Table; readonly score: Score; readonly decisions: readonly StepDecision[];
  readonly burden: { readonly proposed_steps: number; readonly applied_steps: number; readonly samples_shown: number;
    readonly ambiguity_decisions: number; readonly step_precision: number | null };
  readonly guards: { readonly blocks: number; readonly ids: readonly string[]; readonly trap_names: readonly string[] };
  readonly deterministic: { readonly unexplained: number; readonly undo_every_step: boolean; readonly undo_input_hash_equal: boolean; readonly repeat_hash_equal: boolean };
}
export interface EvalRow {
  readonly dataset: string; readonly family: string; readonly split: string; readonly seed: number;
  readonly data_source: 'seeded-synthetic'; readonly generator_version: string;
  readonly population: Population; readonly method: MethodId; readonly mode: ReviewMode | 'not applicable';
  readonly status: 'measured' | 'not yet measured' | 'failed'; readonly reason?: string;
  readonly input: { readonly rows: number; readonly columns: number; readonly cells: number; readonly hash: string };
  readonly metadata?: MeasurementMeta; readonly measurement?: Omit<PlanMeasurement, 'output'>;
  readonly direct_score?: Score; readonly cost_per_1000_cells: number | null;
  readonly subset_selection?: SubsetSelection;
}
const EVAL_TIME = '2000-01-01T00:00:00.000Z'; // stable execution stamp; report run_date carries wall time.
function syntheticMeta(table: Table): ParseMeta {
  const ragged = table.rid.flatMap((rid, index) => table.rows[index].length === table.cols.length ? [] : [{ rid, width: table.rows[index].length }]);
  return { encoding: 'utf-8', bom: false, byte_length: 0, delimiter: ',', delimiter_source: 'user', terminator: '\n',
    terminator_counts: { crlf: 0, lf: table.rows.length + 1, cr: 0 }, other_terminator_records: 0, trailing_terminator: true,
    records: table.rows.length, columns: table.cols.length, header_width: table.cols.length,
    ragged: { count: ragged.length, first: ragged.slice(0, 5) }, warnings: [] };
}
function rawId(value: unknown, index: number): string {
  return value !== null && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? value.id : `item-${index}`;
}
/** Revalidation, guards, preview and approvals are all based on the actually kept predecessor. */
export async function runPlan(data: SeededDataset, rawSteps: readonly unknown[], mode: ReviewMode): Promise<PlanMeasurement> {
  let current = data.dirty; let unparsed = 0;
  const decisions: StepDecision[] = []; const approvals: Approval[] = []; const steps: PlanStep[] = [];
  const duplicateIds = new Set(rawSteps.map(rawId).filter((id, index, ids) => ids.indexOf(id) !== index));
  // Obtain plan context without trusting any raw payload as a typed operation. Revalidated at its real turn below.
  const contextual = rawSteps.slice(0, PLAN_MAX_STEPS).flatMap((raw) => {
    const checked = validateStep(raw, { table: data.dirty, outboundColumnIds: data.dirty.cols.map((c) => c.id), excludedColumnIds: [], duplicateIds });
    return checked.ok ? [checked.step] : [];
  });
  const contextById = new Map(contextual.map((step, index) => [step.id, index]));
  for (let index = 0; index < rawSteps.length; index += 1) {
    const raw = rawSteps[index]; const id = rawId(raw, index);
    const checked = validateStep(raw, { table: current, outboundColumnIds: data.dirty.cols.map((c) => c.id), excludedColumnIds: [], duplicateIds });
    if (!checked.ok || index >= PLAN_MAX_STEPS) {
      decisions.push({ step_id: id, status: 'rejected', reasons: index >= PLAN_MAX_STEPS ? ['too many steps'] : checked.ok ? [] : checked.problems.map((p) => p.message),
        guards: [], traps: [], samples_shown: 0, beneficial: false }); continue;
    }
    const step = checked.step;
    const contextIndex = contextById.get(step.id);
    // A step valid only after a kept predecessor is inserted in its real place for plan-sensitive guards.
    const guardSteps = contextIndex === undefined ? [...steps, step, ...contextual.filter((s) => !steps.some((prior) => prior.id === s.id))] : contextual;
    const guardIndex = guardSteps.findIndex((candidate) => candidate.id === step.id);
    const guards = evaluateGuards(current, step, { steps: guardSteps, index: guardIndex,
      applied: guardSteps.map((candidate) => steps.some((prior) => prior.id === candidate.id)) });
    const traps = data.labels.traps.filter((trap) => guards.some((hit) => GUARDED_TRAPS[hit.guard].includes(trap.name) &&
      (hit.columns.length === 0 || hit.columns.some((column) => trap.columns.includes(column))))).map((trap) => trap.name);
    const preview = previewOne(current, step);
    const samples = Math.min(REVIEW_SAMPLE_ROWS, preview.samples.length + preview.dropped_samples.length);
    const before = scoreDataset(data, current); const after = scoreDataset(data, preview.result.table);
    const beneficial = newlyFixed(before, after) > 0 || after.headers.fixed > before.headers.fixed || after.duplicates.removed > before.duplicates.removed;
    if (mode === 'unreviewed' && guards.length > 0) {
      decisions.push({ step_id: id, status: 'guard-blocked', reasons: guards.map((guard) => guard.message), guards, traps, samples_shown: samples, beneficial: false }); continue;
    }
    if (mode !== 'unreviewed') {
      const choice = oracleDecision(data, current, preview.result.table, mode);
      if (!choice.keep) { decisions.push({ step_id: id, status: 'oracle-rejected', reasons: [choice.reason], guards, traps, samples_shown: samples, beneficial: false }); continue; }
    }
    approvals.push(await createApproval(current, step, guards, guards.map((guard) => guard.guard), EVAL_TIME));
    steps.push(step); current = preview.result.table; unparsed += preview.counts.unparsed;
    decisions.push({ step_id: id, status: 'applied', reasons: [], guards, traps, samples_shown: samples, beneficial });
  }
  // Use the same kept full context on approval creation AND final journal apply (incl. rejected guard-sensitive suffix).
  // Full submitted context is supplied via the validated contextual list; late-valid steps are merged in order.
  const finalSteps = rawSteps.flatMap((raw, index) => {
    const id = rawId(raw, index); const accepted = steps.find((step) => step.id === id) ?? contextual.find((step) => step.id === id);
    return index < PLAN_MAX_STEPS && accepted !== undefined ? [accepted] : [];
  });
  const genesis = await createGenesis(data.dirty, syntheticMeta(data.dirty), `eval-${data.id}`, EVAL_TIME);
  const approved = { steps: finalSteps, approvals };
  const executed = await apply(data.dirty, [genesis], approved, EVAL_TIME);
  if (await hashTable(executed.table) !== await hashTable(current)) throw new Error('Eval preview and journal Apply diverged');
  const unexplained = (await invariant(data.dirty, executed.events, executed.table)).unexplained;
  const undone = await undoAll(data.dirty, executed.events, EVAL_TIME); // validates each inverse predecessor hash.
  const repeated = await apply(data.dirty, [genesis], approved, EVAL_TIME);
  const kept = decisions.filter((decision) => decision.status === 'applied');
  const blocks = decisions.filter((decision) => decision.status === 'guard-blocked');
  return { output: executed.table, score: scoreDataset(data, executed.table, unparsed), decisions,
    burden: { proposed_steps: rawSteps.length, applied_steps: kept.length, samples_shown: decisions.reduce((n, step) => n + step.samples_shown, 0),
      ambiguity_decisions: decisions.filter((decision) => decision.guards.length > 0).length,
      step_precision: rate(kept.filter((step) => step.beneficial).length, kept.length) },
    guards: { blocks: blocks.length, ids: [...new Set(blocks.flatMap((step) => step.guards.map((hit) => hit.guard)))],
      trap_names: [...new Set(blocks.flatMap((step) => step.traps))] },
    deterministic: { unexplained, undo_every_step: true, undo_input_hash_equal: await hashTable(undone.table) === await hashTable(data.dirty),
      repeat_hash_equal: await hashTable(repeated.table) === await hashTable(executed.table) } };
}
export async function evaluateMethod(data: SeededDataset, method: EvalMethod, population: Population, fixtures: readonly unknown[], selection?: SubsetSelection): Promise<EvalRow[]> {
  const cells = data.dirty.rows.reduce((n, row) => n + row.length, 0);
  const base = { dataset: data.id, family: data.family, split: data.split, seed: data.seed, population, method: method.id,
    data_source: 'seeded-synthetic' as const, generator_version: GENERATOR_VERSION,
    input: { rows: data.dirty.rows.length, columns: data.dirty.cols.length, cells, hash: await hashTable(data.dirty) },
    ...(selection === undefined ? {} : { subset_selection: selection }) };
  const modes: readonly (ReviewMode | 'not applicable')[] = method.review_modes ? ['unreviewed', 'oracle', 'oracle+ops'] : ['not applicable'];
  try {
    const local = buildLocalProfile(data.dirty); const outbound = buildOutboundProfile(data.dirty, local, { excludedColumnIds: [] });
    if (!outbound.fits) throw new Error('Outbound profile exceeds bounded envelope');
    const result = await method.propose({ data, local, outbound: outbound.profile, fixtures });
    if (result.status === 'not yet measured') return modes.map((mode) => ({ ...base, mode, status: 'not yet measured', reason: result.reason, cost_per_1000_cells: null }));
    const { status: _status, kind: _kind, ...rest } = result;
    const metadata: MeasurementMeta = { provenance: rest.provenance, cost_usd: rest.cost_usd, latency_ms: rest.latency_ms,
      ...(rest.fixture_id === undefined ? {} : { fixture_id: rest.fixture_id }), ...(rest.model === undefined ? {} : { model: rest.model }),
      ...(rest.provider === undefined ? {} : { provider: rest.provider }), ...(rest.usage === undefined ? {} : { usage: rest.usage }),
      ...(rest.candidate_coverage === undefined ? {} : { candidate_coverage: rest.candidate_coverage }) };
    if (result.kind === 'direct') return [{ ...base, mode: 'not applicable', status: 'measured', metadata,
      direct_score: scoreDataset(data, result.output), cost_per_1000_cells: metadata.cost_usd === null || cells === 0 ? null : metadata.cost_usd * 1000 / cells }];
    const rows: EvalRow[] = [];
    for (const mode of ['unreviewed', 'oracle', 'oracle+ops'] as const) {
      const { output: _output, ...measurement } = await runPlan(data, result.steps, mode);
      rows.push({ ...base, mode, status: 'measured', metadata, measurement,
        cost_per_1000_cells: metadata.cost_usd === null || cells === 0 ? null : metadata.cost_usd * 1000 / cells });
    }
    return rows;
  } catch (error) {
    return modes.map((mode) => ({ ...base, mode, status: 'failed', reason: error instanceof Error ? error.message : String(error), cost_per_1000_cells: null }));
  }
}
async function fixtureRecords(root: string): Promise<unknown[]> {
  let files: string[];
  try { files = await readdir(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  return Promise.all(files.filter((file) => file.endsWith('.json')).sort().map(async (file) => JSON.parse(await readFile(join(root, file), 'utf8')) as unknown));
}
export async function runEvaluation(root: string): Promise<readonly EvalRow[]> {
  const seeded = join(root, 'fixtures', 'seeded');
  try { await access(join(seeded, 'MANIFEST.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await writeSeededFixtures(seeded); }
  const datasets = await loadSeededFixtures(seeded);
  const fixtures = await fixtureRecords(join(root, 'fixtures', 'plans'));
  const rows: EvalRow[] = [];
  for (const data of datasets) {
    const selection = selectSubsetColumns(datasets.filter((dataset) => dataset.split === 'dev'), data.family);
    // Every method is called again on the projected input/profile; full-file plans are never cropped.
    for (const [population, input] of [['full', data], ['matched-200x6', matchedSubset(data, selection)]] as const) {
      for (const method of METHODS) rows.push(...await evaluateMethod(input, method, population, fixtures, population === 'matched-200x6' ? selection : undefined));
    }
  }
  const results = join(root, 'results'); await mkdir(results, { recursive: true });
  await writeFile(join(results, 'results.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  await writeFile(join(results, 'results.md'), renderReport(rows, new Date().toISOString()));
  await updateLimitations(join(root, 'docs', 'LIMITATIONS.md'), rows);
  return rows;
}
const invoked = process.argv[1];
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  if (process.argv.slice(2).length > 0) {
    console.error('M5 eval accepts no live flags. Live provider and budget activation are deferred to M6.'); process.exitCode = 1;
  } else {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    runEvaluation(root).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
  }
}

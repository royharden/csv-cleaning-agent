/** Honest Markdown evidence: baseline rows first; missing measurements remain explicit. */
import type { EvalRow } from './run.ts';
import { METHODS } from './methods.ts';
import type { Score } from './scorer.ts';
const escape = (value: unknown): string => String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const metric = (value: number | null | undefined): string => value == null ? 'unknown' : String(value);
const percent = (value: number | null): string => value === null ? 'N/A (zero denominator)' : `${(value * 100).toFixed(2)}%`;
export function scoreOf(row: EvalRow): Score | undefined { return row.measurement?.score ?? row.direct_score; }
function ordered(rows: readonly EvalRow[]): EvalRow[] {
  return [...rows].sort((a, b) => METHODS.findIndex((method) => method.id === a.method) - METHODS.findIndex((method) => method.id === b.method) ||
    a.population.localeCompare(b.population) || a.split.localeCompare(b.split) || a.dataset.localeCompare(b.dataset) || a.mode.localeCompare(b.mode));
}
function comparison(rows: readonly EvalRow[], method: 'rules' | 'llm', mode: EvalRow['mode']): string {
  const population = rows.filter((row) => row.population === 'matched-200x6' && row.split === 'heldout');
  const target = population.filter((row) => row.method === method && row.mode === mode);
  if (target.length === 0 || target.some((row) => row.status !== 'measured')) return 'not yet measured';
  let tested = 0;
  for (const row of target) {
    const baseline = population.find((candidate) => candidate.dataset === row.dataset && candidate.method === 'llm_direct');
    const actual = scoreOf(row); const direct = baseline === undefined ? undefined : scoreOf(baseline);
    if (baseline?.status !== 'measured' || actual === undefined || direct === undefined) return 'not yet measured';
    // Exact hashes establish that the two methods really received the same matched input.
    if (baseline.input.hash !== row.input.hash) return 'not held (matched input hashes differ)';
    if (actual.cells.wrongly_changed >= direct.cells.wrongly_changed) return 'not held';
    tested += 1;
  }
  return tested === 0 ? 'not yet measured' : `held on ${tested} matched held-out files (see provenance; this is no live-provider claim)`;
}
function jevGate(rows: readonly EvalRow[]): string {
  const population = rows.filter((r) => r.population === 'full' && r.split === 'heldout' && r.mode === 'unreviewed');
  const jev = population.filter((r) => r.method === 'jev-on-rules');
  if (jev.length === 0 || jev.some((r) => r.status !== 'measured' || r.metadata?.provenance !== 'measured-live')) return 'not yet measured (complete live held-out Jev/LLM and rules comparisons required).';
  for (const method of ['rules', 'llm'] as const) {
    let jw = 0; let bw = 0; let jf = 0; let bf = 0; let errors = 0;
    for (const row of jev) {
      const baseline = population.find((r) => r.method === method && r.dataset === row.dataset);
      if (baseline?.status !== 'measured' || baseline.input.hash !== row.input.hash || row.measurement === undefined || baseline.measurement === undefined ||
        (method === 'llm' && baseline.metadata?.provenance !== 'measured-live')) return 'not yet measured (missing matched live/baseline evidence).';
      jw += row.measurement.category_groups.wrongly_merged; bw += baseline.measurement.category_groups.wrongly_merged;
      jf += row.measurement.score.categories.alias?.fixed ?? 0; bf += baseline.measurement.score.categories.alias?.fixed ?? 0;
      errors += row.measurement.score.categories.alias?.errors ?? 0;
    }
    if (errors === 0) return 'not yet measured (no held-out alias denominator).';
    if (jw >= bw || jf < bf) return `not held against ${method}; Jev remains experimental.`;
  }
  return 'held for this measured full-vocabulary held-out population; default selection still requires an explicit owner decision.';
}
export function renderReport(rows: readonly EvalRow[], runDate: string): string {
  const out = [ '# Evaluation results', '', `Run date: ${escape(runDate)}. Data: seeded synthetic fixtures, never customer data.`,
    'Generator version, byte hashes, row lineage, split seeds and owner freeze date are in `fixtures/seeded/MANIFEST.json`; each JSONL row pins its input table hash.',
    'No result exists until the evaluator is executed. Synthetic plan fixture replay is labelled synthetic-fixture and never measured-live. Recorded rules is deterministic local execution.',
    '', 'Literal oracle is primary: keep a step iff it fixes at least one cell and wrongly changes no clean cell, cumulatively in plan order.',
    '`oracle+ops` additionally credits true duplicate/header benefit and vetoes mangles, good-row drops and header/structure damage. It is a labelled extension.',
    '`unreviewed` applies valid steps only when all guards are clear. Direct-cell rewriting has no review mode.',
    'Baselines appear first. Counts and rates use rid/ColumnId alignment. Dropped erroneous cells remain unresolved; good-row drops are a separate damage metric.',
    '', '| Method | Dataset / split | Population | Mode | Provenance | Fixed | Unfixed | Mangled | Wrongly changed | Fix/all | Fix/fixable | Mangle/error | Wrong/clean |',
    '|---|---|---|---|---|---:|---:|---:|---:|---|---|---|---|' ];
  for (const row of ordered(rows)) {
    const score = scoreOf(row); const prefix = `| ${row.method} | ${row.dataset} / ${row.split} | ${row.population} | ${row.mode} | ${row.metadata?.provenance ?? 'not yet measured'}`;
    out.push(score === undefined ? `${prefix} | ${row.status === 'failed' ? 'failed' : 'not yet measured'} | not yet measured | not yet measured | not yet measured | not yet measured | not yet measured | not yet measured | not yet measured |` :
      `${prefix} | ${score.cells.fixed} | ${score.cells.unfixed} | ${score.cells.mangled} | ${score.cells.wrongly_changed} | ${percent(score.rates.fixed_all)} | ${percent(score.rates.fixed_fixable)} | ${percent(score.rates.mangled)} | ${percent(score.rates.wrongly_changed)} |`);
  }
  out.push('', 'Operational metrics and review burden:', '',
    '| Method / dataset / population / mode | Headers fixed | True duplicates removed / total | Good rows dropped | Unparsed | Guard blocks / ids | Proposed / applied steps | Samples | Ambiguity decisions | Step precision | Cost/table USD | Cost/1000 cells USD | Latency ms |',
    '|---|---:|---|---:|---:|---|---|---:|---:|---|---|---|---|');
  for (const row of ordered(rows)) {
    const score = scoreOf(row); if (score === undefined) continue;
    const value = row.measurement;
    out.push(`| ${row.method} / ${row.dataset} / ${row.population} / ${row.mode} | ${score.headers.fixed} | ${score.duplicates.removed}/${score.duplicates.total} (${percent(score.duplicates.recall)}) | ${score.good_rows_dropped.length} | ${score.unparsed} | ${value === undefined ? 'N/A' : `${value.guards.blocks}: ${value.guards.ids.join(', ')}`} | ${value === undefined ? 'N/A' : `${value.burden.proposed_steps}/${value.burden.applied_steps}`} | ${value?.burden.samples_shown ?? 'N/A'} | ${value?.burden.ambiguity_decisions ?? 'N/A'} | ${value === undefined ? 'N/A' : percent(value.burden.step_precision)} | ${metric(row.metadata?.cost_usd)} | ${metric(row.cost_per_1000_cells)} | ${metric(row.metadata?.latency_ms)} |`);
  }
  out.push('', 'Category strata (full vocabulary; eligible-value candidate coverage is a separate diagnostic):', '',
    '| Method / dataset / population / mode | Variant | Fixed / errors | Recall | Mangled | Eligible / full candidate vocabulary |', '|---|---|---|---|---|---|');
  for (const row of ordered(rows)) {
    const score = scoreOf(row); if (score === undefined) continue;
    for (const variant of ['case', 'punctuation', 'typo', 'alias']) {
      const stratum = score.categories[variant]; const coverage = row.metadata?.candidate_coverage;
      out.push(`| ${row.method} / ${row.dataset} / ${row.population} / ${row.mode} | ${variant} | ${stratum?.fixed ?? 0}/${stratum?.errors ?? 0} | ${percent(stratum?.recall ?? null)} | ${stratum?.mangled ?? 0} | ${coverage === undefined ? 'not yet measured' : `${coverage.eligible}/${coverage.full_vocabulary}`} |`);
    }
  }
  out.push('', 'Op recall (fixed labelled cell errors / fixable errors; headers and duplicates are reported separately):', '',
    '| Method / dataset / population / mode | Op | Fixed / errors | Recall |', '|---|---|---|---|');
  for (const row of ordered(rows)) {
    const score = scoreOf(row); if (score === undefined) continue;
    for (const [op, stratum] of Object.entries(score.op_recall)) if (stratum !== undefined) {
      out.push(`| ${row.method} / ${row.dataset} / ${row.population} / ${row.mode} | ${op} | ${stratum.fixed}/${stratum.errors} | ${percent(stratum.recall)} |`);
    }
  }
  out.push('', 'Category groups and disclosure diagnostics (eligible recall never replaces full-vocabulary alias recall):', '',
    '| Method / dataset / population / mode | Applied groups | Wrongly merged | Group precision | Eligible alias fixed/errors (recall) | Transitive bridges |',
    '|---|---:|---:|---|---|---:|');
  for (const row of ordered(rows)) {
    const groups = row.measurement?.category_groups; if (groups === undefined) continue;
    const eligible = row.measurement?.eligible_alias;
    out.push(`| ${row.method} / ${row.dataset} / ${row.population} / ${row.mode} | ${groups.applied} | ${groups.wrongly_merged} | ${percent(groups.precision)} | ${eligible === undefined ? 'not applicable' : `${eligible.fixed}/${eligible.errors} (${percent(eligible.recall)})`} | ${row.metadata?.transitive_bridges?.length ?? 'not applicable'} |`);
  }
  out.push('', 'Deterministic checks and named trap evidence:', '',
    '| Method / dataset / population / mode | Unexplained | Every inverse hash | Full undo hash | Repeat hash | Guard-related trap names | Missed trap names |', '|---|---|---|---|---|---|---|');
  for (const row of ordered(rows)) {
    const value = row.measurement; if (value === undefined) continue;
    out.push(`| ${row.method} / ${row.dataset} / ${row.population} / ${row.mode} | ${value.deterministic.unexplained} | ${value.deterministic.undo_every_step} | ${value.deterministic.undo_input_hash_equal} | ${value.deterministic.repeat_hash_equal} | ${escape(value.guards.trap_names.join(', ') || 'none proposed')} | ${escape(value.score.missed_traps.join(', ') || 'none')} |`);
  }
  out.push('', 'Guard-related trap names match the generator guard-to-trap map and labelled columns of a blocked proposal; absence of a proposal does not prove guard coverage.',
    'All-guard coverage, adversarial-item rejection and the four rules preservation traps require their focused tests plus held-out execution; no aggregate pass is inferred from a missing proposal.',
    '', 'Matched held-out proposal (strictly fewer wrongly changed cells per file than llm_direct):', '');
  for (const method of ['rules', 'llm'] as const) for (const mode of ['unreviewed', 'oracle', 'oracle+ops'] as const) out.push(`- ${method}, ${mode}: ${comparison(rows, method, mode)}.`);
  out.push('', `Jev default-on gate: ${jevGate(rows)} It requires fewer wrongly merged groups than both rules and llm at equal or better full-vocabulary alias recall on held-out.`,
    '', 'Unavailable or failed rows:', '');
  for (const row of ordered(rows)) if (row.status !== 'measured') out.push(`- ${row.method} / ${row.dataset} / ${row.population} / ${row.mode}: ${row.status}: ${escape(row.reason ?? 'no measurement')}`);
  out.push('', 'Unknown billing, usage or latency is unknown rather than zero. Rules has zero provider spend. Fixture replay has no measured model billing/latency. Full per-row provenance, coordinates, decisions and rates are in results.jsonl.', '');
  return out.join('\n');
}

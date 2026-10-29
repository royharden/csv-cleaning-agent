/** Update generated evidence only. The static limitations above the marker are never rewritten. */
import { readFile, writeFile } from 'node:fs/promises';
import type { EvalRow } from './run.ts';
import { scoreOf } from './report.ts';
export const LIMITATIONS_MARKER = '<!-- generated-by-eval:below -->';
const safe = (value: unknown): string => (JSON.stringify(value) ?? 'missing').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function generatedLimitations(rows: readonly EvalRow[]): string {
  const out = ['## Generated evaluation limitations', '', 'Seeded synthetic data only. See results/results.md and results/results.jsonl for population, review mode and measurement provenance.', ''];
  for (const row of rows) {
    const score = scoreOf(row);
    out.push(`### ${row.method} / ${row.dataset} / ${row.population} / ${row.mode}`, '', `Provenance: ${row.metadata?.provenance ?? 'not yet measured'}.`, '');
    if (score === undefined) { out.push(`${row.status}: ${safe(row.reason ?? 'not yet measured')}`, ''); continue; }
    out.push('Wrongly changed cells (every coordinate, by name):', '');
    if (score.wrongly_changed.length === 0) out.push('- None measured.');
    for (const value of score.wrongly_changed) out.push(`- rid ${value.rid}, ${value.column}, trap ${safe(value.trap ?? 'unlabelled clean cell')}: ${safe(value.dirty)} → ${safe(value.actual)}; gold ${safe(value.clean)}.`);
    out.push('', 'Missed or violated traps (every name):', '');
    if (score.missed_traps.length === 0) out.push('- None among scored preserve/repair traps.');
    for (const name of score.missed_traps) out.push(`- ${safe(name)}`);
    if (score.good_rows_dropped.length > 0) out.push('', `Good rows dropped: ${score.good_rows_dropped.join(', ')}.`);
    if (score.unexpected_columns.length > 0 || score.unexpected_rows.length > 0) out.push('', `Unexpected columns ${safe(score.unexpected_columns)}; unexpected rows ${safe(score.unexpected_rows)}.`);
    if (row.measurement?.category_groups !== undefined) {
      out.push('', 'Wrongly merged category groups:', '');
      for (const group of row.measurement.category_groups.wrong) out.push(`- ${safe(group)}`);
    }
    if (row.metadata?.transitive_bridges !== undefined) {
      out.push('', 'Transitive bridge groups (judged member pair below threshold; measured without repair calls):', '');
      for (const bridge of row.metadata.transitive_bridges) out.push(`- ${safe(bridge)}`);
    }
    out.push('');
  }
  out.push('Withhold, validator-reject and byte-format traps require their dedicated checks; absence from the cell missed-trap list is not a pass.', '');
  return out.join('\n');
}
export function replaceGeneratedLimitations(existing: string, generated: string): string {
  const index = existing.indexOf(LIMITATIONS_MARKER);
  if (index < 0 || existing.indexOf(LIMITATIONS_MARKER, index + LIMITATIONS_MARKER.length) >= 0) throw new Error('LIMITATIONS.md needs exactly one generated-by-eval marker; static content was not changed.');
  return existing.slice(0, index + LIMITATIONS_MARKER.length) + '\n\n' + generated;
}
export async function updateLimitations(path: string, rows: readonly EvalRow[]): Promise<void> {
  const existing = await readFile(path, 'utf8');
  await writeFile(path, replaceGeneratedLimitations(existing, generatedLimitations(rows)), 'utf8');
}

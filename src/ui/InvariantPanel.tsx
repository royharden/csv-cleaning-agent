import type { InvariantReport } from '../core/journal/invariant.ts';

export function InvariantPanel({ report, outputHash, inputHash }: { report: InvariantReport; outputHash: string; inputHash: string }) {
  return <section className={`panel invariant-panel ${report.unexplained === 0 ? 'is-clear' : 'has-differences'}`} aria-labelledby="invariant-title">
    <h2 id="invariant-title">Unexplained differences: {report.unexplained}</h2>
    <p>{report.unexplained === 0 ? 'Every current change is explained by the journal, including removed rows.' : 'The current table differs from its recorded history. Review the differences before exporting.'}</p>
    <p>{report.journaled_cell_changes} recorded cell changes · {report.journaled_drops} recorded row removals</p>
    <p>{inputHash === outputHash ? 'Current table fingerprint matches the original table.' : 'Current table fingerprint differs from the original table.'}</p>
    <details><summary>Compare table fingerprints</summary><dl className="hashes"><div><dt>Original table</dt><dd>{inputHash}</dd></div><div><dt>Current table</dt><dd>{outputHash}</dd></div></dl></details>
    {report.differences.length > 0 && <details><summary>Inspect unexplained differences</summary><pre className="json-preview">{JSON.stringify(report.differences, null, 2)}</pre></details>}
  </section>;
}

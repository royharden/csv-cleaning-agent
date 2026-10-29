import type { ParseMeta } from '../core/csv/parse.ts';

export interface ValidationReportProps { meta: ParseMeta; acknowledged: boolean; disabled: boolean; onAcknowledge: (value: boolean) => void }
export function ValidationReport({ meta, acknowledged, disabled, onAcknowledge }: ValidationReportProps) {
  return <section className="panel" aria-labelledby="validation-title"><span className="eyebrow">02 / Check the import</span>
    <h2 id="validation-title">File validation</h2>
    <dl className="stats"><div><dt>Data rows</dt><dd>{meta.records.toLocaleString('en-US')}</dd></div><div><dt>Columns</dt><dd>{meta.columns}</dd></div>
      <div><dt>Encoding</dt><dd>{meta.encoding}</dd></div><div><dt>Separator</dt><dd>{meta.delimiter === '\t' ? 'Tab' : JSON.stringify(meta.delimiter)}</dd></div>
      <div><dt>Line endings</dt><dd>{meta.terminator === '\r\n' ? 'CRLF' : meta.terminator === '\n' ? 'LF' : 'CR'}</dd></div>
      <div><dt>UTF-8 BOM</dt><dd>{meta.bom ? 'Present' : 'Absent'}</dd></div></dl>
    <p>{meta.ragged.count} rows have a different number of fields. Missing fields stay missing.</p>
    {meta.ragged.first.length > 0 && <ul>{meta.ragged.first.map((row) => <li key={row.rid}>Source row {row.rid + 1}: {row.width} fields</li>)}</ul>}
    {meta.other_terminator_records > 0 && <p className="notice">{meta.other_terminator_records} records use other line endings. Export uses the detected majority line ending.</p>}
    {meta.warnings.map((warning, index) => <p className="notice" key={`${warning.code}-${index}`}>{warning.message}</p>)}
    {meta.encoding === 'windows-1252' && <p className="notice">This file was decoded as windows-1252. Cleaned CSV exports use UTF-8; download the original for its exact bytes.</p>}
    <label className="check-row"><input type="checkbox" checked={acknowledged} disabled={disabled} onChange={(event) => onAcknowledge(event.currentTarget.checked)}/>
      I have reviewed this validation report. Allow approved changes to be applied.</label>
  </section>;
}

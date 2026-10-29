export type ExportKind = 'cleaned' | 'journal' | 'plan' | 'rulings' | 'original';
export interface ExportBarProps { disabled: boolean; formulaCount: number; encoding: string; onExport: (kind: ExportKind) => void; onImportPlan: (file: File) => void; onImportRulings: (file: File) => void }
export function ExportBar({ disabled, formulaCount, encoding, onExport, onImportPlan, onImportRulings }: ExportBarProps) {
  return <section className="panel export-panel" aria-labelledby="export-title"><h2 id="export-title">Take your work with you</h2>
    {formulaCount > 0 && <p className="notice">{formulaCount} formula-like cells remain. Spreadsheet apps may execute values beginning with =, +, -, @, a tab or a carriage return. Export preserves these values; inspect them before opening in a spreadsheet.</p>}
    {encoding === 'windows-1252' && <p className="notice">Cleaned CSV uses UTF-8. The original download preserves the original windows-1252 bytes.</p>}
    <div className="actions">{([['cleaned', 'Download cleaned.csv'], ['journal', 'Download journal.jsonl'], ['plan', 'Download plan.json'], ['rulings', 'Download rulings.jsonl'], ['original', 'Download original file']] as const).map(([kind, label]) => <button key={kind} disabled={disabled} className={kind === 'cleaned' ? 'primary' : undefined} onClick={() => onExport(kind)}>{label}</button>)}</div>
    <details><summary>Bring back a saved plan or rejection history</summary><p>Imported plans are checked against this file. Previous approvals do not transfer.</p>
      <label>Import plan.json<input type="file" accept=".json,application/json" disabled={disabled} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onImportPlan(file); event.currentTarget.value = ''; }}/></label>
      <label>Import rulings.jsonl<input type="file" accept=".jsonl,.json,application/json" disabled={disabled} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onImportRulings(file); event.currentTarget.value = ''; }}/></label></details>
  </section>;
}

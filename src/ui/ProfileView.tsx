import type { LocalProfile } from '../core/profile/profile.ts';
import type { ColumnId } from '../core/table.ts';

export interface ProfileViewProps { profile: LocalProfile; excluded: readonly ColumnId[]; disabled: boolean; onToggleColumn: (id: ColumnId) => void }
export function ProfileView({ profile, excluded, disabled, onToggleColumn }: ProfileViewProps) {
  return <section className="panel" aria-labelledby="profile-title"><span className="eyebrow">03 / Understand the data</span><h2 id="profile-title">Column profile <span className="badge">Local only</span></h2>
    <p>{profile.exact_duplicate_rows} exact duplicate rows · {profile.duplicate_rows_after_trim} duplicates after trimming</p>
    <p className="muted">Exclude columns from planner suggestions and the outbound profile. Whole-row duplicate checks still compare every column locally.</p>
    <div className="column-grid">{profile.columns.map((column) => <article className="column-profile" key={column.id}>
      <header><h3>{column.name || '(empty header)'} <small>{column.id}</small></h3><label className="check-row"><input type="checkbox" checked={excluded.includes(column.id)} disabled={disabled} onChange={() => onToggleColumn(column.id)}/>Exclude from planner</label></header>
      <dl className="compact-stats"><div><dt>Distinct</dt><dd>{column.distinct}</dd></div><div><dt>Empty</dt><dd>{column.empty}</dd></div><div><dt>Missing</dt><dd>{column.missing}</dd></div>
        <div><dt>End padding</dt><dd>{column.whitespace.padded}</dd></div><div><dt>Repeated spaces</dt><dd>{column.whitespace.inner_runs}</dd></div><div><dt>Nonbreaking spaces</dt><dd>{column.whitespace.nbsp}</dd></div>
        <div><dt>Invisible spaces</dt><dd>{column.whitespace.zero_width}</dd></div><div><dt>Leading zeros</dt><dd>{column.leading_zero}</dd></div><div><dt>Formula-like</dt><dd>{column.formula_like}</dd></div></dl>
      <details><summary>Values, patterns and possible formats</summary><h4>Top values</h4><ul className="value-list">{column.top_values.map((entry) => <li key={entry.value}><code>{JSON.stringify(entry.value)}</code><span>{entry.count}</span></li>)}</ul>
        <h4>Character patterns</h4><ul>{column.shapes.map((entry) => <li key={entry.shape}><code>{entry.shape}</code> · {entry.count}</li>)}</ul>
        <h4>Possible date formats</h4><ul>{column.date_formats.filter((entry) => entry.count > 0).map((entry) => <li key={entry.format}>{entry.format}: {entry.count}/{column.non_empty}</li>)}</ul>
        <h4>Possible number formats</h4><ul>{column.number_conventions.filter((entry) => entry.count > 0).map((entry) => <li key={`${entry.decimal}-${entry.thousands}`}>Decimal {JSON.stringify(entry.decimal)}, grouping {JSON.stringify(entry.thousands)}: {entry.count}/{column.non_empty}</li>)}</ul>
        <h4>Null-like tokens</h4><ul>{column.null_tokens.map((entry) => <li key={entry.token}><code>{JSON.stringify(entry.token)}</code>: {entry.count}</li>)}</ul>
      </details></article>)}</div></section>;
}

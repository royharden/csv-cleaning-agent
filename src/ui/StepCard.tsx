import type { GuardId } from '../core/constants.ts';
import type { ReviewCard } from '../core/review/state.ts';
import { GuardList } from './GuardList.tsx';

const titles: Readonly<Record<string, string>> = { rename_headers: 'Clean up column names', trim_whitespace: 'Trim whitespace', null_tokens: 'Replace null-like tokens', normalize_case: 'Normalize letter case', parse_number: 'Standardize numbers', standardize_date: 'Standardize dates', map_categories: 'Combine category variants', drop_duplicate_rows: 'Remove duplicate rows' };
export interface StepCardProps {
  card: ReviewCard; selected: boolean; approvalBlocked: boolean; disabled: boolean;
  onSelect: () => void; onApprove: () => void; onReject: () => void; onEdit: () => void; onConfirm: (guard: GuardId) => void;
}
export function StepCard({ card, selected, approvalBlocked, disabled, onSelect, onApprove, onReject, onEdit, onConfirm }: StepCardProps) {
  const preview = card.preview;
  const hasApproval = card.status === 'approved' && card.decision.approval !== undefined;
  const unconfirmed = card.guards.some((hit) => !card.decision.confirmations.includes(hit.guard));
  const columnName = (id: string) => card.predecessor.cols.find((column) => column.id === id)?.name || id;
  return <article id={`step-${card.index}`} className={`step-card ${selected ? 'is-selected' : ''}`} aria-label={`Step ${card.index + 1}`} aria-current={selected ? 'step' : undefined}>
    <header className="step-heading"><div><span className="eyebrow">Step {card.index + 1}</span><h3>{card.step ? titles[card.step.op] : 'Proposal needs correction'}</h3></div>
      <button className="select-step" onClick={onSelect} aria-label={`Select step ${card.index + 1}`} aria-pressed={selected}>{selected ? 'Selected' : 'Select'}</button>
      <span className={`badge status-${card.status}`}>{hasApproval ? 'Approval recorded' : card.status === 'approved' ? 'Approval missing' : card.status === 'stale' ? 'Review again' : card.status === 'unconfirmed' ? 'Needs confirmation' : card.status === 'pending' ? 'Awaiting decision' : card.status === 'invalid' ? 'Invalid proposal' : 'Rejected'}</span></header>
    {card.step && <p className="muted">{card.step.columns.map(columnName).join(' · ') || 'All columns'}</p>}
    {card.reasons.length > 0 && <ul className="notice">{card.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
    {preview && <><dl className="stats step-counts"><div><dt>Changed cells</dt><dd>{preview.counts.changed}</dd></div><div><dt>Left unparsed</dt><dd>{preview.counts.unparsed}</dd></div>
      <div><dt>Dropped rows</dt><dd>{preview.counts.dropped}</dd></div><div><dt>Changed headers</dt><dd>{preview.counts.headers}</dd></div></dl>
      <p className="muted">Preview across the full file, after approved earlier steps only. Source row numbers exclude the header.</p>
      <h4>Changed-row examples <small>First {preview.samples.length} of up to 5</small></h4>
      {preview.samples.length === 0 ? <p className="muted">No cell values change.</p> : <div className="table-scroll"><table><thead><tr><th>Source row</th><th>Column</th><th>Before</th><th>After</th></tr></thead>
        <tbody>{preview.samples.flatMap((sample) => sample.cells.map((cell) => <tr key={`${sample.rid}-${cell.col}`}><td>{sample.rid + 1}</td><td>{columnName(cell.col)}</td><td><code>{JSON.stringify(cell.old)}</code></td><td><code>{JSON.stringify(cell.new)}</code></td></tr>))}</tbody></table></div>}
      <h4>Largest exact edits <small>Up to 3 · edit distance</small></h4>
      <ol className="largest-edits">{preview.largest_edits.map((edit) => <li key={`${edit.rid}-${edit.col}`}>Source row {edit.rid + 1}, {columnName(edit.col)} · distance {edit.distance}<div><code>{JSON.stringify(edit.old)}</code><span aria-hidden="true"> → </span><code>{JSON.stringify(edit.new)}</code></div></li>)}</ol>
      {preview.header_change && <div><h4>Header changes</h4><ul>{preview.header_change.id.map((id, index) => <li key={id}><code>{JSON.stringify(preview.header_change?.old[index])}</code> → <code>{JSON.stringify(preview.header_change?.new[index])}</code></li>)}</ul></div>}
      {preview.dropped_samples.length > 0 && <details><summary>Dropped-row examples</summary><ul>{preview.dropped_samples.map((sample) => <li key={sample.rid}>Source row {sample.rid + 1}: <code>{JSON.stringify(sample.row)}</code></li>)}</ul></details>}
      {preview.unparsed_samples.length > 0 && <details><summary>Values left unparsed</summary><ul>{preview.unparsed_samples.map((sample) => <li key={`${sample.rid}-${sample.col}`}>Source row {sample.rid + 1}, {columnName(sample.col)}: <code>{JSON.stringify(sample.value)}</code></li>)}</ul></details>}
      {preview.mapping && <details><summary>Category replacements</summary><ul>{preview.mapping.pairs.map(([from, to]) => <li key={from}><code>{JSON.stringify(from)}</code> → <code>{JSON.stringify(to)}</code></li>)}</ul></details>}
    </>}
    {card.step?.rationale && <blockquote className="rationale"><span className="eyebrow">Planner rationale · untrusted text</span><p>{card.step.rationale}</p></blockquote>}
    <GuardList guards={card.guards} confirmations={card.decision.confirmations} disabled={disabled} onConfirm={onConfirm}/>
    {card.decision.reason && <p className="decision-reason">Rejection reason: {card.decision.reason}</p>}
    {card.decision.humanEdited && <p className="muted">Edited by you · checked again before approval</p>}
    {hasApproval && <details><summary>Recorded approval</summary><dl className="hashes"><div><dt>Proposal fingerprint</dt><dd>{card.decision.approval?.params_hash}</dd></div><div><dt>Preview input fingerprint</dt><dd>{card.decision.approval?.predecessor_hash}</dd></div></dl></details>}
    {card.status === 'stale' && <p className="notice">An earlier decision changed this preview. Review it and record a fresh approval.</p>}
    {approvalBlocked && <p className="muted">Decide earlier pending steps before approving this one.</p>}
    <div className="actions"><button className="primary" disabled={disabled || !card.step || approvalBlocked || unconfirmed || hasApproval} onClick={onApprove}>Approve <kbd>a</kbd></button>
      <button disabled={disabled} onClick={onReject}>Reject with reason <kbd>r</kbd></button><button disabled={disabled} onClick={onEdit}>Edit proposal <kbd>e</kbd></button></div>
  </article>;
}

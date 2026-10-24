import { useEffect, useRef, useState } from 'react';
import type { ReviewAction, ReviewCard, ReviewState } from '../core/review/state.ts';
import { DATE_FORMATS } from '../core/constants.ts';
import { reviewKey } from './keys.ts';
import { StepCard } from './StepCard.tsx';

export interface PlanReviewProps { review: ReviewState; disabled: boolean; onAction: (action: ReviewAction) => void }
type FormKind = 'reject' | 'edit' | null;
function earlierPending(review: ReviewState, index: number): boolean {
  return review.cards.some((card) => card.index < index && !['approved', 'rejected', 'invalid'].includes(card.status));
}

function EditProposal({ card, disabled, onSave, onCancel }: { card: ReviewCard; disabled: boolean; onSave: (step: unknown) => void; onCancel: () => void }) {
  const [text, setText] = useState(JSON.stringify(card.raw, null, 2) ?? 'null');
  const [error, setError] = useState('');
  const step = card.step;
  const [date, setDate] = useState(() => {
    const params = step?.params;
    return params && typeof params === 'object' && 'from_format' in params && typeof params.from_format === 'string' ? params.from_format : '';
  });
  // Category editing is exposed as values, with the complete proposal available for other operations.
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const observed = step?.op === 'map_categories' ? [...new Set(card.predecessor.rows.flatMap((row) => {
    const index = card.predecessor.cols.findIndex((column) => column.id === step.columns[0]);
    return index >= 0 && index < row.length ? [row[index]] : [];
  }))] : [];
  return <form className="decision-form" aria-label="Edit proposal" onSubmit={(event) => {
    event.preventDefault();
    try {
      if (step?.op === 'standardize_date') onSave({ ...step, params: { from_format: date } });
      else if (step?.op === 'map_categories') {
        if (!source || !target) { setError('Choose a source value and a replacement value.'); return; }
        onSave({ ...step, params: { groups: [{ from: [source], to: target }] } });
      } else onSave(JSON.parse(text) as unknown);
    } catch { setError('The proposal must be valid JSON. Your edit has not been saved.'); }
  }}><h3>Edit step {card.index + 1}</h3><p>Saving checks this proposal again, refreshes its preview, and clears its approval. Review the result before approving.</p>
    {step?.op === 'standardize_date' ? <label>Date order used by this column<select autoFocus value={date} disabled={disabled} onChange={(event) => setDate(event.currentTarget.value)}>{DATE_FORMATS.map((format) => <option key={format}>{format}</option>)}</select></label>
      : step?.op === 'map_categories' ? <><p>This replaces the category mapping with the single replacement below. Values shown are observed in this preview.</p><label>Replace this value<select autoFocus value={source} disabled={disabled} onChange={(event) => setSource(event.currentTarget.value)}><option value="">Choose a value</option>{observed.map((value) => <option key={value} value={value}>{JSON.stringify(value)}</option>)}</select></label>
        <label>With this value<input value={target} list={`category-targets-${card.index}`} disabled={disabled} onChange={(event) => setTarget(event.currentTarget.value)}/></label><datalist id={`category-targets-${card.index}`}>{observed.map((value) => <option key={value} value={value}/>)}</datalist><p className="muted">A new value requires an additional confirmation.</p></>
        : <label>Proposal JSON<textarea autoFocus rows={12} spellCheck={false} value={text} disabled={disabled} onChange={(event) => setText(event.currentTarget.value)}/></label>}
    {error && <p role="alert" className="notice">{error}</p>}
    <div className="actions"><button className="primary" disabled={disabled} type="submit">Save and preview</button><button type="button" disabled={disabled} onClick={onCancel}>Cancel edit</button></div>
  </form>;
}

export function PlanReview({ review, disabled, onAction }: PlanReviewProps) {
  const [selected, setSelected] = useState(0);
  const [form, setForm] = useState<FormKind>(null);
  const [reason, setReason] = useState('');
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const index = Math.min(selected, Math.max(0, review.cards.length - 1));
  const card = review.cards[index];
  const approvalBlocked = earlierPending(review, index);
  function approve() {
    if (!card || disabled || approvalBlocked || !card.step || card.status === 'approved' || card.guards.some((hit) => !card.decision.confirmations.includes(hit.guard))) return;
    onAction({ type: 'approve', index, decidedAt: new Date().toISOString() });
  }
  function openForm(kind: FormKind, nextIndex = index) { setSelected(nextIndex); setReason(''); setForm(kind); }
  useEffect(() => { if (form === 'reject') reasonInput.current?.focus(); }, [form]);
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (form || disabled) return;
      const action = reviewKey(event);
      if (!action || !card) return;
      event.preventDefault();
      if (action === 'next' || action === 'previous') {
        const next = Math.max(0, Math.min(review.cards.length - 1, index + (action === 'next' ? 1 : -1)));
        setSelected(next);
        document.getElementById(`step-${next}`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      } else if (action === 'approve') approve();
      else if (action === 'reject' || action === 'edit') openForm(action);
      else {
        const hit = card.guards.find((guard) => !card.decision.confirmations.includes(guard.guard));
        if (hit) onAction({ type: 'confirm', index, guard: hit.guard });
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });
  const approved = review.cards.filter((item) => item.status === 'approved' && item.decision.approval !== undefined).length;
  return <section className="review-section" aria-labelledby="review-title"><div className="section-heading"><div><span className="eyebrow">04 / You make the decisions</span><h2 id="review-title">Review the transform plan</h2></div><span className="badge">{approved} / {review.cards.length} approvals recorded</span></div>
    <p>Nothing changes until you apply. Approve in order; reject or edit any proposal. Earlier decisions can change later previews.</p>
    <p className="keyboard-help"><kbd>j</kbd> next · <kbd>k</kbd> previous · <kbd>a</kbd> approve · <kbd>r</kbd> reject · <kbd>e</kbd> edit · <kbd>c</kbd> confirm next guard</p>
    <p className="muted" aria-live="polite">{review.cards.length ? `Selected step ${index + 1} of ${review.cards.length}` : 'No changes proposed. Your table stays as imported.'}</p>
    {form && card && <div className="form-shell">{form === 'reject' ? <form className="decision-form" aria-label="Reject proposal" onSubmit={(event) => {
      event.preventDefault(); if (!reason.trim() || disabled) return;
      onAction({ type: 'reject', index, reason: reason.trim() }); setForm(null);
    }}><h3>Reject step {index + 1}</h3><label>Reason for rejecting<textarea ref={reasonInput} required value={reason} rows={3} disabled={disabled} onChange={(event) => setReason(event.currentTarget.value)}/></label>
      <p className="muted">This reason can be reused when the same proposal appears on the same data profile.</p><div className="actions"><button className="danger" disabled={disabled || !reason.trim()} type="submit">Save rejection</button><button disabled={disabled} type="button" onClick={() => setForm(null)}>Cancel rejection</button></div></form>
      : <EditProposal key={`${index}-${JSON.stringify(card.raw)}`} card={card} disabled={disabled} onSave={(step) => { onAction({ type: 'edit', index, step }); setForm(null); }} onCancel={() => setForm(null)}/>}</div>}
    {review.cards.map((item) => <StepCard key={item.index} card={item} selected={item.index === index} approvalBlocked={earlierPending(review, item.index)} disabled={disabled || form !== null}
      onSelect={() => setSelected(item.index)} onApprove={() => { if (!disabled) onAction({ type: 'approve', index: item.index, decidedAt: new Date().toISOString() }); }}
      onReject={() => openForm('reject', item.index)} onEdit={() => openForm('edit', item.index)} onConfirm={(guard) => onAction({ type: 'confirm', index: item.index, guard })}/>)}</section>;
}

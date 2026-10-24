import type { GuardId } from '../core/constants.ts';
import type { GuardHit } from '../core/transformkit/guards.ts';

export interface GuardListProps { guards: readonly GuardHit[]; confirmations: readonly GuardId[]; disabled: boolean; onConfirm: (guard: GuardId) => void }
export function GuardList({ guards, confirmations, disabled, onConfirm }: GuardListProps) {
  if (guards.length === 0) return null;
  return <section className="guard-list" aria-label="Decisions that need confirmation"><h4>Pause and confirm</h4>
    {guards.map((hit) => <div className="guard" key={hit.guard}><p>{hit.message}</p>
      <dl className="guard-details">{Object.entries(hit.details).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{String(value)}</dd></div>)}</dl>
      <button disabled={disabled || confirmations.includes(hit.guard)} onClick={() => onConfirm(hit.guard)} aria-label={`Confirm ${hit.guard}`}>
        {confirmations.includes(hit.guard) ? 'Confirmed' : 'I understand — confirm this decision'}</button>
    </div>)}<p className="muted">Each confirmation applies to this proposal and the data shown in its preview.</p></section>;
}

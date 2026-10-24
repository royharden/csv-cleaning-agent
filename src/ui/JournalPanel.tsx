import type { ApplyEvent, JournalEvent } from '../core/journal/events.ts';

export interface JournalPanelProps { events: readonly JournalEvent[]; active: readonly ApplyEvent[]; disabled: boolean; onUndoLast: () => void; onUndoAll: () => void; onUndoTo: (keepCount: number) => void }
export function JournalPanel({ events, active, disabled, onUndoLast, onUndoAll, onUndoTo }: JournalPanelProps) {
  return <section className="panel" aria-labelledby="journal-title"><span className="eyebrow">05 / A complete change history</span><h2 id="journal-title">Journal & undo</h2>
    <p>{active.length} applied steps in effect · {events.length} recorded events. Undo adds a record and restores recorded values.</p>
    <div className="actions"><button disabled={disabled || active.length === 0} onClick={onUndoLast}>Undo last step</button><button disabled={disabled || active.length === 0} onClick={onUndoAll}>Undo all changes</button></div>
    {active.length > 0 && <div className="undo-list"><h3>Restore an earlier point</h3><ol>{active.map((event, index) => <li key={event.event_hash}><span>{event.step_id} <small>{event.op.replaceAll('_', ' ')}</small></span><button disabled={disabled || index === active.length - 1} onClick={() => onUndoTo(index + 1)}>Keep through step {index + 1}</button></li>)}</ol></div>}
    <details><summary>Inspect journal events and fingerprints</summary><ol className="journal-list">{events.map((event) => <li key={event.seq}><strong>#{event.seq} {event.kind}{event.kind === 'apply' ? ` · ${event.step_id}` : event.kind === 'undo' ? ` · undo ${event.undo_of.step_id}` : ' · original file'}</strong>
      <dl className="hashes"><div><dt>Event fingerprint</dt><dd>{event.event_hash}</dd></div><div><dt>Previous event</dt><dd>{event.prev_event_hash ?? 'Start of journal'}</dd></div>
        <div><dt>Input fingerprint</dt><dd>{event.input_hash}</dd></div>{event.kind !== 'genesis' && <div><dt>Output fingerprint</dt><dd>{event.output_hash}</dd></div>}</dl>
      {event.kind === 'apply' && <p>{event.changes.rid.length} cell changes · {event.dropped?.rid.length ?? 0} rows dropped · {event.header_change?.id.length ?? 0} headers changed</p>}</li>)}</ol></details>
  </section>;
}

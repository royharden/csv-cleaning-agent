import type { LiveGate } from '../core/live/gate.ts';

export function ModeBanner({ gate, live, disabled, onConnect, onToggle }: {
  readonly gate?: LiveGate; readonly live: boolean; readonly disabled: boolean;
  readonly onConnect: () => void; readonly onToggle: (value: boolean) => void;
}) {
  return <aside className="mode-banner" aria-label="Planner connection mode"><div><strong>{live ? 'Live planning enabled' : 'Mock mode'}</strong>
    <p>{live ? 'The displayed screened profile goes to the selected provider. Review is still required.' : 'Offline rules + synthetic fixture replay. Nothing leaves this device.'}</p></div>
    <div><button type="button" disabled={disabled || gate?.enabled === true} onClick={onConnect}>Connect live session</button>{' '}
      <label><input type="checkbox" checked={live} disabled={disabled || gate?.enabled !== true} onChange={(event) => { onToggle(event.target.checked); }} /> Live planning</label>
      <p id="live-reason" className="muted">{gate?.reason ?? 'Live connection has not been checked.'}</p>
      {live && <p>Browser billing is unknown. The owner’s provider/project hard cap is the global boundary.</p>}</div></aside>;
}

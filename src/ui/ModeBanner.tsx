export function ModeBanner({ configured }: { configured: boolean }) {
  return <aside className="mode-banner" aria-label="Planner connection mode"><div><strong>Mock mode</strong><p>Offline rules + synthetic fixture replay. Nothing leaves this device.</p></div>
    <div><button disabled aria-describedby="live-reason">Live planning unavailable</button><p id="live-reason" className="muted">{configured ? 'Live planning needs a configured provider spending cap and an authenticated connection before activation.' : 'No cloud connection is configured. Offline rules remain available.'}</p></div></aside>;
}

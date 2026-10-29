import type { OutboundBuild } from '../core/profile/outbound.ts';

export function OutboundPreview({ outbound }: { outbound: OutboundBuild }) {
  return <section className="panel" aria-labelledby="outbound-title"><h2 id="outbound-title">What a model would receive</h2>
    <p>The file stays here. A live planner would receive only this screened summary, after your exclusions.</p>
    <p>{outbound.withheld_values_total} values withheld as instruction-like · {outbound.withheld_labels.length} headers withheld · {outbound.excluded.length} columns excluded</p>
    <p className="muted">At most {outbound.profile.values_per_column} shared values per column, each up to 40 characters. Displayed JSON is the exact outbound profile.</p>
    {!outbound.fits && <p className="notice" role="alert">This summary exceeds the allowed size. Exclude more columns before requesting a plan.</p>}
    {outbound.reductions.map((reason) => <p className="notice" key={reason}>{reason}</p>)}
    <details><summary>Inspect outbound profile · {outbound.bytes.toLocaleString('en-US')} bytes</summary><pre className="json-preview">{JSON.stringify(outbound.profile, null, 2)}</pre></details>
  </section>;
}

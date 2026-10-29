/** Public owner attestation only. A browser ledger cannot enforce a global spend ceiling. */
export interface LiveGate { readonly enabled: boolean; readonly reason: string }
export function liveGate(flag: unknown, configured: boolean, authenticated: boolean): LiveGate {
  if (flag !== '1') return { enabled: false, reason: 'Owner must configure a hard provider/project spending cap, then set VITE_LIVE_ENABLED=1.' };
  if (!configured) return { enabled: false, reason: 'No Supabase connection is configured.' };
  if (!authenticated) return { enabled: false, reason: 'Obtain an authenticated anonymous Supabase session to enable live planning.' };
  return { enabled: true, reason: 'Owner hard-cap attestation and authenticated session present.' };
}

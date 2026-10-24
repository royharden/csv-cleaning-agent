import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function configuredClient(env: Readonly<Record<string, unknown>>): SupabaseClient | null {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (typeof url !== 'string' || !url.trim() || typeof key !== 'string' || !key.trim()) return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false } });
  } catch { return null; }
}

// Construction of the client makes no call. M6 owns explicit live activation and anonymous sign-in.
export const supabase = configuredClient(import.meta.env);

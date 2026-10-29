/** Only this file binds the portable function to Deno and server secrets. */
import { createClient } from '@supabase/supabase-js';
import { requireSecret } from './contract.ts';
import { createJudgeHandler } from './provider.ts';

const handler = createJudgeHandler({
  allowedOrigins: (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((value) => value.trim()).filter((value) => value.length > 0 && value !== '*'),
  authenticate: async (token) => {
    const client = createClient(requireSecret(Deno.env.get('SUPABASE_URL'), 'SUPABASE_URL'), requireSecret(Deno.env.get('SUPABASE_ANON_KEY'), 'SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await client.auth.getUser(token);
    return !error && typeof data.user?.id === 'string' && data.user.id.length > 0;
  },
  getConfig: () => ({ apiKey: requireSecret(Deno.env.get('TYPESAFE_API_KEY'), 'TYPESAFE_API_KEY') }),
});
Deno.serve(handler);

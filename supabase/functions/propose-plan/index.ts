/** Only this file binds the portable function to Deno and server secrets. */
import { createClient } from '@supabase/supabase-js';
import { requireSecret } from './contract.ts';
import { createProposeHandler, generativeConfigFromSecrets } from './provider.ts';

const handler = createProposeHandler({
  allowedOrigins: (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((value) => value.trim()).filter((value) => value.length > 0 && value !== '*'),
  authenticate: async (token) => {
    const client = createClient(requireSecret(Deno.env.get('SUPABASE_URL'), 'SUPABASE_URL'), requireSecret(Deno.env.get('SUPABASE_ANON_KEY'), 'SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await client.auth.getUser(token);
    // Anonymous *users* have an id; the project anon key alone does not yield a user.
    return !error && typeof data.user?.id === 'string' && data.user.id.length > 0;
  },
  getConfig: () => generativeConfigFromSecrets({
    ANTHROPIC_API_KEY: Deno.env.get('ANTHROPIC_API_KEY'), OPENAI_COMPAT_API_KEY: Deno.env.get('OPENAI_COMPAT_API_KEY'),
    OPENAI_COMPAT_BASE_URL: Deno.env.get('OPENAI_COMPAT_BASE_URL'), PLANNER_MODEL: Deno.env.get('PLANNER_MODEL'),
  }),
});
Deno.serve(handler);

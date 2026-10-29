/** Portable provider adapter. Dependencies/secrets are explicit; Node eval reuses this exact call path.
 * One HTTP attempt per invocation. Never log headers, requests, responses, or provider exceptions. */
import { z } from 'zod';
import {
  EndpointError, OUTPUT_MAX_TOKENS, ProposePlanRequestSchema, corsHeaders, failureResponse,
  jsonResponse, readBoundedJson, requireSecret, requireUser, usageFrom, withDeadline,
  type Authenticate, type ProviderSuccess,
} from './contract.ts';
import { buildProposePrompt, type GenerativePrompt } from './prompt.ts';

export interface GenerativeConfig {
  readonly provider: 'anthropic' | 'openai-compatible';
  readonly apiKey: string;
  readonly model: string;
  /** Owner-configured API root, e.g. https://api.openai.com/v1. Never taken from a client. */
  readonly baseUrl?: string;
}
export interface ProviderOptions {
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly requestId?: string;
}
export interface PlannerSecrets {
  readonly ANTHROPIC_API_KEY?: string;
  readonly OPENAI_COMPAT_API_KEY?: string;
  readonly OPENAI_COMPAT_BASE_URL?: string;
  readonly PLANNER_MODEL?: string;
}
export function generativeConfigFromSecrets(secrets: PlannerSecrets): GenerativeConfig {
  const model = requireSecret(secrets.PLANNER_MODEL, 'PLANNER_MODEL');
  if (secrets.ANTHROPIC_API_KEY?.trim()) return { provider: 'anthropic', apiKey: secrets.ANTHROPIC_API_KEY, model };
  if (secrets.OPENAI_COMPAT_API_KEY?.trim() || secrets.OPENAI_COMPAT_BASE_URL?.trim()) return {
    provider: 'openai-compatible',
    apiKey: requireSecret(secrets.OPENAI_COMPAT_API_KEY, 'OPENAI_COMPAT_API_KEY'),
    baseUrl: requireSecret(secrets.OPENAI_COMPAT_BASE_URL, 'OPENAI_COMPAT_BASE_URL'), model,
  };
  return { provider: 'anthropic', apiKey: requireSecret(undefined, 'ANTHROPIC_API_KEY'), model };
}

function endpoint(config: GenerativeConfig): string {
  if (config.provider === 'anthropic') return 'https://api.anthropic.com/v1/messages';
  let url: URL;
  try { url = new URL(requireSecret(config.baseUrl, 'OPENAI_COMPAT_BASE_URL')); }
  catch (error) {
    if (error instanceof EndpointError) throw error;
    throw new EndpointError('invalid_configuration', 503, 'OPENAI_COMPAT_BASE_URL is invalid.', 'Owner: configure an HTTPS API root without credentials, query, or fragment.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new EndpointError('invalid_configuration', 503, 'OPENAI_COMPAT_BASE_URL must be an HTTPS API root.', 'Owner: use an HTTPS URL without credentials, query, or fragment.');
  return `${url.href.replace(/\/+$/, '')}/chat/completions`;
}

const AnthropicResponse = z.object({
  model: z.string().min(1),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
  usage: z.unknown().optional(),
}).passthrough();
const OpenAIResponse = z.object({
  model: z.string().min(1),
  choices: z.array(z.object({ message: z.object({ content: z.string() }).passthrough() }).passthrough()).min(1),
  usage: z.unknown().optional(),
}).passthrough();

/** Server-owned prompt and config only. The direct-eval caller supplies its own closed synthetic-row prompt. */
export async function callGenerative(prompt: GenerativePrompt, config: GenerativeConfig, options: ProviderOptions = {}): Promise<ProviderSuccess> {
  requireSecret(config.apiKey, config.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_COMPAT_API_KEY');
  requireSecret(config.model, 'PLANNER_MODEL');
  const url = endpoint(config);
  const started = performance.now();
  const fetcher = options.fetch ?? fetch;
  const result = await withDeadline(async (signal) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    let body: unknown;
    if (config.provider === 'anthropic') {
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      body = { model: config.model, max_tokens: OUTPUT_MAX_TOKENS, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] };
    } else {
      headers.authorization = `Bearer ${config.apiKey}`;
      body = { model: config.model, max_tokens: OUTPUT_MAX_TOKENS, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }] };
    }
    let response: Response;
    try { response = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' }); }
    catch {
      signal.throwIfAborted();
      throw new EndpointError('provider_unavailable', 502, 'The provider request failed.', 'Check owner provider configuration and retry manually; no retry was made.');
    }
    if (!response.ok) throw new EndpointError('provider_error', 502, `The provider returned HTTP ${response.status}.`, 'Check provider quota/configuration and retry manually; no retry was made.');
    let payload: unknown;
    try { payload = await response.json() as unknown; }
    catch { throw new EndpointError('provider_shape', 502, 'The provider returned invalid JSON.', 'Check provider compatibility; no repair or retry was made.'); }
    const requestId = response.headers.get('request-id') ?? response.headers.get('x-request-id') ?? options.requestId ?? crypto.randomUUID();
    if (config.provider === 'anthropic') {
      const parsed = AnthropicResponse.safeParse(payload);
      if (!parsed.success || parsed.data.content.some((part) => part.type === 'text' && part.text === undefined)) throw new EndpointError('provider_shape', 502, 'The provider response has an unexpected shape.');
      const raw = parsed.data.content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('');
      if (!raw) throw new EndpointError('provider_shape', 502, 'The provider returned no text.');
      const rawUsage = parsed.data.usage ?? null;
      return { raw, raw_usage: rawUsage, usage: usageFrom(rawUsage, 'input_tokens', 'output_tokens'), model: parsed.data.model, request_id: requestId };
    }
    const parsed = OpenAIResponse.safeParse(payload);
    if (!parsed.success || !parsed.data.choices[0].message.content) throw new EndpointError('provider_shape', 502, 'The provider response has an unexpected shape.');
    const rawUsage = parsed.data.usage ?? null;
    return { raw: parsed.data.choices[0].message.content, raw_usage: rawUsage, usage: usageFrom(rawUsage, 'prompt_tokens', 'completion_tokens'), model: parsed.data.model, request_id: requestId };
  }, options.signal);
  return { ok: true, ...result, provider: config.provider, latency_ms: Math.round(performance.now() - started) };
}

export interface ProposeHandlerDependencies {
  readonly allowedOrigins: readonly string[];
  readonly authenticate: Authenticate;
  readonly getConfig: () => GenerativeConfig;
  readonly call?: typeof callGenerative;
}
/** HTTP orchestration is portable and injectable for contract tests; only index.ts binds Deno/auth/secrets. */
export function createProposeHandler(dependencies: ProposeHandlerDependencies): (request: Request) => Promise<Response> {
  return async (request) => {
    let cors: Headers | undefined;
    try {
      cors = corsHeaders(request, dependencies.allowedOrigins);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') throw new EndpointError('method_not_allowed', 405, 'Use POST.');
      return await withDeadline(async (signal) => {
        await requireUser(request, dependencies.authenticate);
        const raw = await readBoundedJson(request, signal);
        const parsed = ProposePlanRequestSchema.safeParse(raw);
        if (!parsed.success) throw new EndpointError('invalid_request', 400, 'The outbound profile envelope is invalid.', 'Rebuild the screened outbound profile; extra fields and client provider configuration are forbidden.');
        signal.throwIfAborted();
        const config = dependencies.getConfig();
        const result = await (dependencies.call ?? callGenerative)(buildProposePrompt(parsed.data.profile), config, { signal });
        return jsonResponse(result, 200, cors);
      });
    } catch (error) { return failureResponse(error, cors); }
  };
}

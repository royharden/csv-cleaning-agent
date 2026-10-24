/** Node owns credentials, dated prices, durable local receipts and serial paid invocations. */
import { appendFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CallLedger } from '../../src/core/ledger/callledger.ts';
import type { PriceTable } from '../../src/core/providers/types.ts';
import type { Invoke, ProviderReply } from '../../src/core/planners/llm.ts';
import { callGenerative, type GenerativeConfig } from '../../supabase/functions/propose-plan/provider.ts';
import { buildProposePrompt } from '../../supabase/functions/propose-plan/prompt.ts';
import { ProposePlanRequestSchema } from '../../supabase/functions/propose-plan/contract.ts';
import { callJudgeCategories, callTypeSafeTestPair, type SyntheticPairState } from '../../supabase/functions/judge-categories/provider.ts';
import { JudgeCategoriesRequestSchema } from '../../supabase/functions/judge-categories/contract.ts';
import { directPrompt } from './llm_direct.ts';
import type { Table } from '../../src/core/table.ts';

export interface LiveRuntime {
  readonly invoke: Invoke;
  readonly direct: (table: Table, hash: string) => Promise<ProviderReply>;
  readonly testPair: (state: SyntheticPairState) => Promise<ProviderReply>;
  readonly thresholds: unknown;
  readonly begin: () => void;
  readonly last: () => { readonly cost_usd: number | null; readonly latency_ms: number | null; readonly provider?: string; readonly model?: string };
}
async function environment(root: string): Promise<Record<string, string | undefined>> {
  let content = '';
  try { content = await readFile(join(root, '.env.local'), 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const env: Record<string, string | undefined> = {};
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match === null) throw new Error('Eval .env.local requires plain NAME=value lines.');
    const value = match[2].trim(); env[match[1]] = value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
  }
  return { ...env, ...process.env };
}
export async function createLiveRuntime(root: string, ledgerPath: string): Promise<LiveRuntime> {
  const env = await environment(root);
  const pricePath = env.EVAL_PRICE_TABLE;
  if (!pricePath) throw new Error('Unknown spend: set EVAL_PRICE_TABLE to an owner-verified dated JSON price table before --live.');
  const prices = JSON.parse(await readFile(resolve(root, pricePath), 'utf8')) as PriceTable;
  const ledger = new CallLedger(new Date().toISOString(), prices);
  const model = env.PLANNER_MODEL ?? '';
  const provider = env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai-compatible';
  const apiKey = env.ANTHROPIC_API_KEY ?? env.OPENAI_COMPAT_API_KEY;
  const generativeConfig = (): GenerativeConfig => {
    if (!model || !apiKey) throw new Error('Set PLANNER_MODEL and ANTHROPIC_API_KEY or OPENAI_COMPAT_API_KEY for a generative live call.');
    if (provider === 'openai-compatible' && !env.OPENAI_COMPAT_BASE_URL) throw new Error('Set owner OPENAI_COMPAT_BASE_URL for compatible live calls.');
    return { provider, apiKey, model, ...(env.OPENAI_COMPAT_BASE_URL ? { baseUrl: env.OPENAI_COMPAT_BASE_URL } : {}) };
  };
  const thresholds: unknown = JSON.parse(await readFile(join(root, 'fixtures', 'jev-thresholds.json'), 'utf8'));
  let last = { cost_usd: null as number | null, latency_ms: null as number | null, provider: '', model: '' };
  const paid = async (method: string, providerName: string, modelName: string, hash: string, inputBytes: number,
    invoke: () => Promise<ProviderReply>): Promise<ProviderReply> => {
    const reservation = ledger.reserve(method, providerName, modelName, hash);
    // UTF-8 bytes plus conservative fixed framing allowance; owner bounds must cover complete billed input.
    if (reservation.price.max_input_tokens < inputBytes + 4096 || (providerName !== 'typesafe' && reservation.price.max_output_tokens < 4096)) {
      ledger.settle(reservation, null, null, 'Configured worst-case bounds are below the bounded request/output allowance.');
      await appendFile(ledgerPath, JSON.stringify(ledger.records.at(-1)) + '\n');
      throw new Error('Owner price-table token bounds do not cover the complete request and 4096-token output cap.');
    }
    // Reservation is durable BEFORE the paid call; a process crash leaves an unresolved reservation.
    await appendFile(ledgerPath, JSON.stringify(ledger.records.at(-1)) + '\n');
    let response: ProviderReply;
    try { response = await invoke(); }
    catch (error) {
      ledger.settle(reservation, null, null, error instanceof Error ? error.message : String(error));
      await appendFile(ledgerPath, JSON.stringify(ledger.records.at(-1)) + '\n'); throw error;
    }
    const usage = response.usage === null ? null : { raw: response.raw_usage ?? response.usage,
      input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens };
    const row = ledger.settle(reservation, usage, response.latency_ms);
    await appendFile(ledgerPath, JSON.stringify(row) + '\n');
    last = { cost_usd: last.cost_usd === null || row.cost_usd === null ? null : last.cost_usd + row.cost_usd,
      latency_ms: last.latency_ms === null || row.latency_ms === null ? null : last.latency_ms + row.latency_ms, provider: row.provider, model: row.model };
    if (ledger.blocked) throw new Error('Live call has unknown usage/cost or exceeded its reservation; no further paid calls permitted.');
    return response;
  };
  const invoke: Invoke = async (name, body) => {
    const { hashOutboundProfile } = await import('../../src/core/planners/fixture.ts');
    if (name === 'propose-plan') {
      const request = ProposePlanRequestSchema.parse(body); const prompt = buildProposePrompt(request.profile);
      const config = generativeConfig();
      return paid('llm', provider, model, await hashOutboundProfile(request.profile), new TextEncoder().encode(JSON.stringify(prompt)).length,
        () => callGenerative(prompt, config));
    }
    const request = JudgeCategoriesRequestSchema.parse(body);
    if (!env.TYPESAFE_API_KEY) throw new Error('Missing TYPESAFE_API_KEY for live Jev.');
    return paid('jev-on-rules', 'typesafe', 'jev-1.13.0', await hashOutboundProfile(request.profile), new TextEncoder().encode(JSON.stringify(request)).length + request.pairs.length * 1024,
      () => callJudgeCategories(request, { apiKey: env.TYPESAFE_API_KEY! }));
  };
  return { invoke, thresholds, begin: () => { last = { cost_usd: 0, latency_ms: 0, provider: 'offline-rules', model: 'none' }; }, last: () => last, async direct(table, hash) {
    const prompt = directPrompt(table, 'seeded-synthetic');
    const config = generativeConfig();
    return paid('llm_direct', provider, model, hash, new TextEncoder().encode(JSON.stringify(prompt)).length, () => callGenerative(prompt, config));
  }, async testPair(state) {
    if (!env.TYPESAFE_API_KEY) throw new Error('Missing TYPESAFE_API_KEY for explicit synthetic robustness harness.');
    const { hashCanonicalJson } = await import('../../src/core/journal/hash.ts');
    return paid('jev-robustness-explicit-synthetic', 'typesafe', 'jev-1.13.0', await hashCanonicalJson(state),
      new TextEncoder().encode(JSON.stringify(state)).length + 2048, () => callTypeSafeTestPair(state, { apiKey: env.TYPESAFE_API_KEY! }));
  } };
}

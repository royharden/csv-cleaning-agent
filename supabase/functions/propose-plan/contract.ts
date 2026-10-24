/** Deployable-folder-local boundary. Keep its profile grammar aligned with src/core/profile/outbound.ts.
 * Extra screening here also rejects forged HTTP clients that bypass the browser withholding builder.
 * No environment reads, provider calls, or Deno globals. */
import { z } from 'zod';

export const BODY_MAX_BYTES = 65_536;
export const TIMEOUT_MS = 30_000;
export const OUTPUT_MAX_TOKENS = 4_096;
export const DATE_FORMATS = ['YYYY-MM-DD', 'YYYY/MM/DD', 'YYYY.MM.DD', 'YYYYMMDD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY', 'MM-DD-YYYY', 'DD.MM.YYYY', 'MM.DD.YYYY', 'DD/MM/YY', 'MM/DD/YY'] as const;
export const NULL_TOKENS = ['NA', 'N/A', 'n/a', 'NULL', 'null', 'None', 'none', 'nan', 'NaN', '#N/A', '-', '--', '?', 'missing', '(blank)'] as const;
export const WITHHOLD_PATTERNS = [/ignore (all|the|previous|above)/i, /disregard/i, /system prompt/i, /you are/i, /assistant:/i, /instruction/i, /answer yes/i, /respond with/i, /act as/i, /<\//i, /\{\{/i, /\[\[/i, /BEGIN/i, /[\r\n]/];
export function isScreened(value: string): boolean {
  return !WITHHOLD_PATTERNS.some((pattern) => pattern.test(value));
}
const Count = z.number().int().min(0).max(20_000);
const textWithin = (max: number) => z.string().refine((value) => Array.from(value).length <= max, `at most ${max} characters`);
export const ColumnIdSchema = z.string().regex(/^c(?:[0-9]|[1-5][0-9])$/);
const SafeText = textWithin(40).refine(isScreened, 'instruction-like text must be withheld');
const OutboundColumnSchema = z.object({
  id: ColumnIdSchema,
  label: SafeText,
  label_withheld: z.literal(true).optional(),
  non_empty: Count, empty: Count, missing: Count, distinct: Count,
  values: z.array(z.object({ value: SafeText, count: Count, truncated: z.literal(true).optional() }).strict()).max(8),
  withheld_values: Count,
  shapes: z.array(z.object({
    shape: textWithin(40).refine((value) => /^[AaL9 *\-_. ,:;\/()#@+%&'"!?$=]*$/.test(value), 'expected character classes'),
    count: Count,
  }).strict()).max(3),
  date_formats: z.array(z.object({ format: z.enum(DATE_FORMATS), count: Count }).strict()).max(DATE_FORMATS.length),
  number_conventions: z.array(z.object({ decimal: z.enum(['.', ',']), thousands: z.enum([',', '.', ' ', 'none']), count: Count }).strict()).max(6),
  whitespace: z.object({ padded: Count, inner_runs: Count, nbsp: Count, zero_width: Count }).strict(),
  leading_zero: Count, formula_like: Count,
  null_tokens: z.array(z.object({ token: z.enum(NULL_TOKENS), count: Count }).strict()).max(NULL_TOKENS.length),
}).strict();

export const OutboundProfileSchema = z.object({
  version: z.literal(1), records: Count, exact_duplicate_rows: Count, duplicate_rows_after_trim: Count,
  values_per_column: z.number().int().min(0).max(8), columns: z.array(OutboundColumnSchema).max(60),
}).strict().superRefine((profile, ctx) => {
  const ids = new Set<string>();
  profile.columns.forEach((column, index) => {
    if (ids.has(column.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['columns', index, 'id'], message: 'duplicate column id' });
    ids.add(column.id);
    if (column.values.length > profile.values_per_column) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['columns', index, 'values'], message: 'exceeds shared allowance' });
    // Distinct originals may share a clipped prefix, including one also observed exactly.
    const exactValues = column.values.filter((entry) => entry.truncated !== true);
    if (new Set(exactValues.map((entry) => entry.value)).size !== exactValues.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['columns', index, 'values'], message: 'duplicate disclosed value' });
    if (column.label_withheld && column.label !== '[withheld]') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['columns', index, 'label'], message: 'withheld label must be the placeholder' });
  });
  if (new TextEncoder().encode(JSON.stringify(profile)).byteLength > 60_000) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'profile exceeds 60000 bytes' });
});
type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type OutboundProfile = DeepReadonly<z.infer<typeof OutboundProfileSchema>>;
export const ProposePlanRequestSchema = z.object({ profile: OutboundProfileSchema }).strict();
export type ProposePlanRequest = DeepReadonly<z.infer<typeof ProposePlanRequestSchema>>;

export interface Usage { readonly input_tokens: number | null; readonly output_tokens: number | null }
export interface ProviderSuccess {
  readonly ok: true;
  readonly raw: string;
  readonly usage: Usage | null;
  readonly raw_usage: unknown | null;
  readonly model: string;
  readonly provider: string;
  readonly request_id: string;
  readonly latency_ms: number;
}
export interface EndpointFailure {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string; readonly action: string };
}
export class EndpointError extends Error {
  readonly code: string;
  readonly status: number;
  readonly action: string;
  constructor(code: string, status: number, message: string, action = 'Review the request and try again manually.') {
    super(message);
    this.name = 'EndpointError';
    this.code = code;
    this.status = status;
    this.action = action;
  }
}
export function missingSecret(name: string): never {
  // Only compile-time variable names are passed by the adapter, never an exception or credential value.
  throw new EndpointError('missing_secret', 503, `${name} is not set`, 'Owner: add it in Bolt server secrets.');
}
export function requireSecret(value: string | undefined, name: string): string {
  if (!value?.trim()) missingSecret(name);
  return value;
}
export function bearerToken(request: Request): string {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) throw new EndpointError('unauthenticated', 401, 'A signed-in user JWT is required.', 'Obtain an anonymous Supabase user session and send its access token.');
  return match[1];
}
export type Authenticate = (token: string) => Promise<boolean>;
export async function requireUser(request: Request, authenticate: Authenticate): Promise<void> {
  const token = bearerToken(request);
  let authenticated = false;
  try { authenticated = await authenticate(token); } catch (error) {
    if (error instanceof EndpointError && error.code === 'missing_secret') throw error;
    // Never return auth transport details.
  }
  if (!authenticated) throw new EndpointError('unauthenticated', 401, 'The user session is invalid.', 'Sign in anonymously again and use the user access token, not the project anon key.');
}

/** Header rejection + actual streamed byte count; never call request.json()/text() on an uncapped body. */
export async function readBoundedJson(request: Request, signal?: AbortSignal): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > BODY_MAX_BYTES)) {
    throw new EndpointError('body_too_large', 413, `Request body must be at most ${BODY_MAX_BYTES} bytes.`);
  }
  if ((request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new EndpointError('content_type', 415, 'Content-Type must be application/json.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new EndpointError('invalid_json', 400, 'A JSON body is required.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const next = await reader.read();
      signal?.throwIfAborted();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > BODY_MAX_BYTES) {
        await reader.cancel();
        throw new EndpointError('body_too_large', 413, `Request body must be at most ${BODY_MAX_BYTES} bytes.`);
      }
      chunks.push(next.value);
    }
  } finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown; }
  catch { throw new EndpointError('invalid_json', 400, 'Body must contain valid UTF-8 JSON.'); }
}

export function corsHeaders(request: Request, allowedOrigins: readonly string[]): Headers {
  if (allowedOrigins.length === 0) missingSecret('ALLOWED_ORIGINS');
  const origin = request.headers.get('origin');
  if (origin && !allowedOrigins.includes(origin)) throw new EndpointError('origin_not_allowed', 403, 'This application origin is not allowed.', 'Owner: configure ALLOWED_ORIGINS with exact application origins.');
  const headers = new Headers({ Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Max-Age': '600' });
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}
export function jsonResponse(value: ProviderSuccess | EndpointFailure, status: number, cors?: Headers): Response {
  const headers = new Headers(cors);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(value), { status, headers });
}
export function failureResponse(error: unknown, cors?: Headers): Response {
  const known = error instanceof EndpointError ? error : new EndpointError('internal_error', 500, 'The request could not be completed.', 'Retry manually; owner can inspect provider configuration.');
  return jsonResponse({ ok: false, error: { code: known.code, message: known.message, action: known.action } }, known.status, cors);
}
export async function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, externalSignal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelExternal: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    cancelExternal = () => {
      const error = new EndpointError('cancelled', 408, 'The request was cancelled.', 'Retry manually when ready.');
      controller.abort(error);
      reject(error);
    };
    if (externalSignal?.aborted) { cancelExternal(); return; }
    externalSignal?.addEventListener('abort', cancelExternal, { once: true });
    timer = setTimeout(() => {
      const error = new EndpointError('timeout', 504, 'The request exceeded 30 seconds.', 'Retry manually; no automatic provider retry was made.');
      controller.abort(error);
      reject(error);
    }, TIMEOUT_MS);
  });
  try {
    if (controller.signal.aborted) return await deadline;
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (cancelExternal) externalSignal?.removeEventListener('abort', cancelExternal);
  }
}
export function usageFrom(raw: unknown, inputKey: string, outputKey: string): Usage | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const object = raw as Record<string, unknown>;
  const token = (key: string) => typeof object[key] === 'number' && Number.isSafeInteger(object[key]) && object[key] >= 0 ? object[key] as number : null;
  return { input_tokens: token(inputKey), output_tokens: token(outputKey) };
}

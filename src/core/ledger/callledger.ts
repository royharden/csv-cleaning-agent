import type { CallRecord, PriceEntry, PriceTable, UsageRecord } from '../providers/types.ts';

export function validatePrices(value: PriceTable): PriceTable {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Number.isFinite(Date.parse(value.date))) throw new Error('A dated owner price table is required.');
  const keys = new Set<string>();
  for (const price of value.entries) {
    const key = `${price.provider}/${price.model}`;
    if (!price.provider || !price.model || keys.has(key)) throw new Error('Price table has a missing or duplicate provider/model.');
    keys.add(key);
    if (![price.input_usd_per_million, price.output_usd_per_million].every((n) => Number.isFinite(n) && n >= 0) ||
      !Number.isSafeInteger(price.max_input_tokens) || price.max_input_tokens <= 0 ||
      !Number.isSafeInteger(price.max_output_tokens) || price.max_output_tokens < 0) throw new Error('Invalid owner price or worst-case token bound.');
  }
  return value;
}
export function usageCost(usage: UsageRecord | null, price: PriceEntry): number | null {
  if (usage === null || usage.input_tokens === null || usage.output_tokens === null) return null;
  if (![usage.input_tokens, usage.output_tokens].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  return (usage.input_tokens * price.input_usd_per_million + usage.output_tokens * price.output_usd_per_million) / 1_000_000;
}
export interface Reservation { readonly span: string; readonly price: PriceEntry; readonly reserved_usd: number }
/** Local serial reservation boundary; this is NOT a global/provider spend enforcement mechanism. */
export class CallLedger {
  private readonly rows: CallRecord[] = [];
  private pending: Reservation | undefined;
  private stopped = false;
  private spent = 0;
  private readonly prices: PriceTable;
  private readonly run: string;
  private readonly cap: number;
  constructor(run: string, prices: PriceTable, cap = 5) {
    if (!Number.isFinite(cap) || cap <= 0 || cap > 5) throw new Error('Live eval cap must be positive and at most 5 USD.');
    this.run = run; this.prices = validatePrices(prices); this.cap = cap;
  }
  get records(): readonly CallRecord[] { return [...this.rows]; }
  get blocked(): boolean { return this.stopped; }
  reserve(method: string, provider: string, model: string, hash: string): Reservation {
    if (this.stopped) throw new Error('Live run stopped: previous cost/usage is unknown or exceeded its reservation.');
    if (this.pending !== undefined) throw new Error('Live calls must run serially; an outstanding reservation exists.');
    const price = this.prices.entries.find((p) => p.provider === provider && p.model === model);
    if (price === undefined) { this.stopped = true; throw new Error(`Unknown spend for ${provider}/${model}; configure a dated owner price and worst-case token bounds.`); }
    const reserved = (price.max_input_tokens * price.input_usd_per_million + price.max_output_tokens * price.output_usd_per_million) / 1_000_000;
    if (!Number.isFinite(reserved) || this.spent + reserved > this.cap) throw new Error('Live eval reservation would exceed the 5 USD run cap.');
    const reservation = { span: `${this.run}:${this.rows.length + 1}`, price, reserved_usd: reserved };
    this.pending = reservation;
    this.rows.push({ run: this.run, span: reservation.span, method, provider, model, outbound_profile_hash: hash,
      usage: null, latency_ms: null, status: 'reserved', price_table_date: this.prices.date,
      cost_usd: null, reserved_usd: reserved, cost_provenance: 'unknown' });
    return reservation;
  }
  settle(reservation: Reservation, usage: UsageRecord | null, latency: number | null, error?: string): CallRecord {
    if (this.pending !== reservation) throw new Error('Reservation is not the active call.');
    const cost = usageCost(usage, reservation.price);
    const exceeded = usage !== null && ((usage.input_tokens ?? Infinity) > reservation.price.max_input_tokens ||
      (usage.output_tokens ?? Infinity) > reservation.price.max_output_tokens);
    if (cost === null || exceeded || cost > reservation.reserved_usd) this.stopped = true;
    if (cost !== null) this.spent += cost;
    const prior = this.rows[this.rows.length - 1];
    const row: CallRecord = { ...prior, usage, latency_ms: latency, cost_usd: cost,
      status: cost === null || exceeded ? 'unknown' : error === undefined ? 'ok' : 'failed',
      cost_provenance: cost === null ? 'unknown' : 'owner-price-table', ...(error === undefined ? {} : { error }) };
    this.rows[this.rows.length - 1] = row; this.pending = undefined;
    return row;
  }
}

/** Data records only. Provider implementations and credentials stay outside the browser core. */
export interface UsageRecord {
  readonly raw: unknown;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
}
export interface CallRecord {
  readonly run: string;
  readonly span: string;
  readonly method: string;
  readonly provider: string;
  readonly model: string;
  readonly outbound_profile_hash: string;
  readonly usage: UsageRecord | null;
  readonly latency_ms: number | null;
  readonly status: 'reserved' | 'ok' | 'failed' | 'unknown';
  readonly price_table_date: string;
  readonly cost_usd: number | null;
  readonly reserved_usd: number;
  readonly cost_provenance: 'owner-price-table' | 'unknown';
  readonly error?: string;
}
export interface PriceEntry {
  readonly provider: string;
  readonly model: string;
  readonly input_usd_per_million: number;
  readonly output_usd_per_million: number;
  /** Owner-verified bound on ALL billed input (prompt, data and request overhead). */
  readonly max_input_tokens: number;
  readonly max_output_tokens: number;
}
export interface PriceTable {
  readonly date: string;
  readonly entries: readonly PriceEntry[];
}

/** Shared browser/Node planner contract (C §2.8). Proposals still need validator + human review. */
import type { OutboundProfile } from '../profile/outbound.ts';
import type { LocalProfile } from '../profile/profile.ts';

export type PlannerSource = 'rules' | 'live' | 'fixture' | 'synthetic-fixture';

export interface PlannerUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
}

export interface PlannerResult {
  /** Unknown items are retained so the validator can show individual model/fixture rejection reasons. */
  readonly steps: readonly unknown[];
  readonly raw?: string;
  readonly usage?: PlannerUsage;
  readonly source: PlannerSource;
  /** Local explanations, e.g. a column left untouched because evidence is unavailable. */
  readonly notes?: readonly string[];
}

export interface Planner {
  plan(outboundProfile: OutboundProfile, localProfile?: LocalProfile): Promise<PlannerResult>;
}

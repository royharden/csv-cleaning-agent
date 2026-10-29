/** Pure fixture replay (PLAN.md rows 25, §8.1–2). No fs, fetch, live call, or fallback. */
import { z } from 'zod';
import { JEV_MAX_PAIRS_PER_REQUEST, MAX_COLUMNS, OUTBOUND_VALUES_PER_COLUMN } from '../constants.ts';
import { hashCanonicalJson, isSha256Hex } from '../journal/hash.ts';
import type { OutboundProfile } from '../profile/outbound.ts';
import { isColumnId } from '../table.ts';

export type FixturePlanner = 'llm' | 'jev';
export type FixtureErrorCode = 'fixture_invalid' | 'fixture_duplicate' | 'fixture_not_keyed' | 'fixture_missing' | 'fixture_threshold_missing';

export class FixtureError extends Error {
  readonly code: FixtureErrorCode;
  constructor(code: FixtureErrorCode, message: string) {
    super(message);
    this.name = 'FixtureError';
    this.code = code;
  }
}

const columnId = z.string().refine(isColumnId, 'expected a ColumnId c0..c59');
const pairSchema = z.object({ a: z.string().min(1), b: z.string().min(1), score: z.number().finite().min(0).max(1) }).strict();
const pairColumnSchema = z.object({
  column: columnId,
  pairs: z.array(pairSchema).max(OUTBOUND_VALUES_PER_COLUMN * (OUTBOUND_VALUES_PER_COLUMN - 1) / 2),
}).strict();
const base = {
  fixture_id: z.string().min(1),
  source: z.enum(['synthetic-fixture', 'recorded']),
  source_csv: z.string().min(1),
  excluded_column_ids: z.array(columnId).max(MAX_COLUMNS),
  profile_hash: z.string().refine((value) => value === 'PENDING' || isSha256Hex(value), 'expected PENDING or lowercase SHA-256'),
};
const fixtureSchema = z.discriminatedUnion('planner', [
  z.object({ ...base, planner: z.literal('llm'), steps: z.array(z.unknown()) }).strict(),
  z.object({ ...base, planner: z.literal('jev'), pairs: z.array(pairColumnSchema).max(MAX_COLUMNS),
    threshold: z.number().finite().min(0).max(1).optional() }).strict(),
]);

export type FixtureRecord = z.infer<typeof fixtureSchema>;
export type CategoryPairScores = z.infer<typeof pairColumnSchema>;
export type FixturePayload =
  | { readonly planner: 'llm'; readonly steps: readonly unknown[]; readonly source: 'synthetic-fixture' | 'fixture'; readonly fixture_id: string }
  | { readonly planner: 'jev'; readonly pairs: readonly CategoryPairScores[]; readonly threshold: number;
      readonly source: 'synthetic-fixture' | 'fixture'; readonly fixture_id: string };

/** Shared hash implementation for browser lookup, eval and fixtures:rekey. Hash ONLY the outbound profile. */
export async function hashOutboundProfile(profile: OutboundProfile): Promise<string> {
  return hashCanonicalJson(profile);
}

/** Validate fixture envelopes, preserving adversarial step payloads for the normal per-item plan validator. */
export function validateFixtureRecords(records: readonly unknown[]): FixtureRecord[] {
  const keys = new Map<string, string>();
  return records.map((record, index) => {
    const parsed = fixtureSchema.safeParse(record);
    if (!parsed.success) {
      throw new FixtureError('fixture_invalid', `Fixture record ${index}: ${parsed.error.issues.map((issue) =>
        `${issue.path.join('.') || 'record'}: ${issue.message}`).join('; ')}. Repair the fixture envelope.`);
    }
    const value = parsed.data;
    if (new Set(value.excluded_column_ids).size !== value.excluded_column_ids.length) {
      throw new FixtureError('fixture_invalid', `Fixture ${value.fixture_id} repeats excluded_column_ids; list each ColumnId once.`);
    }
    if (value.planner === 'jev') {
      const ids = new Set<string>();
      let total = 0;
      for (const column of value.pairs) {
        if (ids.has(column.column)) throw new FixtureError('fixture_invalid', `Fixture ${value.fixture_id} repeats pair column ${column.column}.`);
        ids.add(column.column);
        const pairs = new Set<string>();
        const values = new Set<string>();
        for (const pair of column.pairs) {
          const key = JSON.stringify([pair.a, pair.b].sort());
          if (pair.a === pair.b || pairs.has(key)) {
            throw new FixtureError('fixture_invalid', `Fixture ${value.fixture_id} has a self/repeated pair in ${column.column}; keep one score per unordered pair.`);
          }
          pairs.add(key);
          values.add(pair.a);
          values.add(pair.b);
        }
        if (values.size > OUTBOUND_VALUES_PER_COLUMN) {
          throw new FixtureError('fixture_invalid', `Fixture ${value.fixture_id} exceeds the shared ${OUTBOUND_VALUES_PER_COLUMN}-value allowance in ${column.column}.`);
        }
        total += column.pairs.length;
      }
      if (total > JEV_MAX_PAIRS_PER_REQUEST) {
        throw new FixtureError('fixture_invalid', `Fixture ${value.fixture_id} exceeds ${JEV_MAX_PAIRS_PER_REQUEST} pair scores.`);
      }
    }
    const key = JSON.stringify([value.planner, value.profile_hash]);
    const prior = keys.get(key);
    if (prior !== undefined) {
      throw new FixtureError('fixture_duplicate', `Duplicate fixture key (${value.planner}, ${value.profile_hash}): ${prior} and ${value.fixture_id}; retain one record per key.`);
    }
    keys.set(key, value.fixture_id);
    return value;
  });
}

/**
 * records are JSON values: browser callers supply glob modules' `.default`; Node callers read the directory.
 * A PENDING record is never usable, including when profileHash itself is PENDING. Source identity is retained
 * in source_csv + exclusions and rekeyed by the CLI, never guessed from fixture filenames or a sampled row.
 */
export function loadFixture(records: readonly unknown[], planner: FixturePlanner, profileHash: string): FixturePayload {
  const fixtures = validateFixtureRecords(records);
  if (profileHash !== 'PENDING' && !isSha256Hex(profileHash)) {
    throw new FixtureError('fixture_invalid', 'Fixture lookup needs the current outbound-profile SHA-256; rebuild and hash the outbound profile.');
  }
  const match = profileHash === 'PENDING' ? undefined : fixtures.find((record) => record.planner === planner && record.profile_hash === profileHash);
  if (match === undefined) {
    if (fixtures.some((record) => record.planner === planner && record.profile_hash === 'PENDING')) {
      throw new FixtureError('fixture_not_keyed', `Fixture not yet keyed for ${planner}: run npm run fixtures:rekey after installing dependencies, then reload.`);
    }
    throw new FixtureError('fixture_missing', `No ${planner} fixture for outbound profile ${profileHash}. Add a fixture with the correct source_csv and excluded_column_ids, then run npm run fixtures:rekey; choose rules for offline planning.`);
  }
  const source = match.source === 'synthetic-fixture' ? 'synthetic-fixture' : 'fixture';
  if (match.planner === 'llm') return { planner: 'llm', steps: match.steps, source, fixture_id: match.fixture_id };
  if (match.threshold === undefined) {
    throw new FixtureError('fixture_threshold_missing', `Jev fixture ${match.fixture_id} has no synthetic replay threshold; add threshold in [0,1]. An unfrozen live threshold is not a fixture default.`);
  }
  return { planner: 'jev', pairs: match.pairs, threshold: match.threshold, source, fixture_id: match.fixture_id };
}

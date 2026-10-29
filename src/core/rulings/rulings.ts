import { z } from 'zod';
import { OP_NAMES } from '../constants.ts';
import { hashCanonicalJson } from '../journal/hash.ts';
import { buildLocalProfile, profileColumn } from '../profile/profile.ts';
import { HashSchema } from '../review/approvals.ts';
import { isColumnId, type Table } from '../table.ts';
import type { PlanStep } from '../transformkit/registry.ts';

export const RulingSchema = z.object({
  v: z.literal(1), kind: z.literal('plan_step'), op: z.enum(OP_NAMES),
  columns: z.array(z.string().refine(isColumnId)), params_hash: HashSchema, column_profile_hash: HashSchema,
  decision: z.literal('reject'), reason: z.string().trim().min(1), created_at: z.string().datetime(), human_edited: z.boolean().optional(),
}).strict();
export type Ruling = z.infer<typeof RulingSchema>;

export async function rulingKey(table: Table, step: PlanStep): Promise<Pick<Ruling, 'op' | 'columns' | 'params_hash' | 'column_profile_hash'>> {
  const columns = [...step.columns];
  const profiles = columns.map((id) => {
    const index = table.cols.findIndex((c) => c.id === id);
    if (index < 0) throw new Error(`unknown ruling column ${id}`);
    return profileColumn(table, index);
  });
  return { op: step.op, columns, params_hash: await hashCanonicalJson(step.params),
    column_profile_hash: await hashCanonicalJson(columns.length === 0 ? buildLocalProfile(table) : profiles) };
}

export async function createRuling(table: Table, step: PlanStep, reason: string, createdAt: string, humanEdited = false): Promise<Ruling> {
  return RulingSchema.parse({ v: 1, kind: 'plan_step', ...await rulingKey(table, step), decision: 'reject', reason,
    created_at: createdAt, ...(humanEdited ? { human_edited: true } : {}) });
}

export async function replayRuling(table: Table, step: PlanStep, records: readonly unknown[]): Promise<{ status: 'rejected'; reason: string; ruling: Ruling } | null> {
  const key = await rulingKey(table, step);
  const rulings = records.map((raw) => RulingSchema.parse(raw));
  for (const ruling of [...rulings].reverse()) {
    if (ruling.op === key.op && JSON.stringify(ruling.columns) === JSON.stringify(key.columns) && ruling.params_hash === key.params_hash && ruling.column_profile_hash === key.column_profile_hash)
      return { status: 'rejected', reason: ruling.reason, ruling };
  }
  return null;
}
export function serializeRulings(rulings: readonly Ruling[]): string { return rulings.map((r) => JSON.stringify(RulingSchema.parse(r))).join('\n') + (rulings.length ? '\n' : ''); }
export function parseRulings(text: string): Ruling[] {
  const lines = text.split(/\r?\n/); if (lines.at(-1) === '') lines.pop();
  return lines.map((line, i) => { try { return RulingSchema.parse(JSON.parse(line)); } catch (error) { throw new Error(`ruling ${i}: ${String(error)}`); } });
}

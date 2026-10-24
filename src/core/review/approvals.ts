import { z } from 'zod';
import { GUARD_IDS } from '../constants.ts';
import { hashCanonicalJson, hashTable } from '../journal/hash.ts';
import type { Table } from '../table.ts';
import type { GuardHit } from '../transformkit/guards.ts';
import type { PlanStep } from '../transformkit/registry.ts';

export const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const ApprovalSchema = z.object({
  step_id: z.string().min(1).max(64),
  params_hash: HashSchema,
  predecessor_hash: HashSchema,
  guard_confirmations: z.array(z.enum(GUARD_IDS)).refine((a) => new Set(a).size === a.length, 'duplicate guard confirmation'),
  decided_at: z.string().datetime(),
  human_edited: z.boolean().optional(),
}).strict();
export type Approval = z.infer<typeof ApprovalSchema>;

export async function createApproval(
  table: Table, step: PlanStep, guards: readonly GuardHit[], confirmations: readonly string[],
  decidedAt: string, humanEdited = false,
): Promise<Approval> {
  const approval = ApprovalSchema.parse({
    step_id: step.id, params_hash: await hashCanonicalJson(step.params), predecessor_hash: await hashTable(table),
    guard_confirmations: [...confirmations], decided_at: decidedAt, ...(humanEdited ? { human_edited: true } : {}),
  });
  await assertApproval(approval, table, step, guards);
  return approval;
}

export async function assertApproval(approval: Approval, table: Table, step: PlanStep, guards: readonly GuardHit[]): Promise<void> {
  ApprovalSchema.parse(approval);
  if (approval.step_id !== step.id) throw new Error(`approval.step_id: expected ${step.id}`);
  if (approval.params_hash !== await hashCanonicalJson(step.params)) throw new Error(`approval.params_hash: stale approval for ${step.id}`);
  if (approval.predecessor_hash !== await hashTable(table)) throw new Error(`approval.predecessor_hash: stale approval for ${step.id}`);
  for (const hit of guards) {
    if (!approval.guard_confirmations.includes(hit.guard)) throw new Error(`approval.guard_confirmations: confirm ${hit.guard} for ${step.id}`);
  }
}

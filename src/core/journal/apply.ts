import type { ColumnId, Table } from '../table.ts';
import { PLAN_MAX_STEPS } from '../constants.ts';
import { assertApproval, type Approval } from '../review/approvals.ts';
import { evaluateGuards } from '../transformkit/guards.ts';
import { applyStep, getOp, type PlanStep } from '../transformkit/registry.ts';
import { validateStep } from '../transformkit/validator.ts';
import { ApplyEventSchema, sealEvent, type JournalEvent } from './events.ts';
import { fold, type FoldResult } from './fold.ts';
import { hashCanonicalJson, hashTable } from './hash.ts';

export interface ApprovedPlan {
  /** Full current plan, including rejected cards, used to recheck plan-sensitive guards. */
  readonly steps: readonly PlanStep[];
  readonly approvals: readonly Approval[];
  readonly excludedColumnIds?: readonly ColumnId[];
  readonly outboundColumnIds?: readonly ColumnId[];
}

/** Apply only recorded approvals; every validation and guard uses the actual approved-only predecessor. */
export async function apply(
  input: Table, journal: readonly JournalEvent[], approvedPlan: ApprovedPlan, createdAt: string,
): Promise<FoldResult> {
  const prior = await fold(input, journal);
  let table = prior.table;
  const events = [...prior.events];
  const steps = approvedPlan.steps;
  if (steps.length > PLAN_MAX_STEPS) throw new Error(`plan limit is ${PLAN_MAX_STEPS} steps`);
  if (new Set(steps.map((s) => s.id)).size !== steps.length) throw new Error('duplicate step ids');
  if (new Set(approvedPlan.approvals.map((a) => a.step_id)).size !== approvedPlan.approvals.length) throw new Error('duplicate approvals');
  const approvals = new Map(approvedPlan.approvals.map((approval) => [approval.step_id, approval]));
  for (const id of approvals.keys()) if (!steps.some((s) => s.id === id)) throw new Error(`approval names unknown step ${id}`);
  const applied = steps.map(() => false);
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const approval = approvals.get(step.id);
    if (approval === undefined) continue;
    const checked = validateStep(step, { table,
      outboundColumnIds: approvedPlan.outboundColumnIds ?? table.cols.map((c) => c.id),
      excludedColumnIds: approvedPlan.excludedColumnIds ?? [], humanEdited: approval.human_edited === true });
    if (!checked.ok) throw new Error(`step ${step.id}: ${checked.problems.map((p) => p.message).join('; ')}`);
    const guards = evaluateGuards(table, checked.step, { steps, index, applied, humanEdited: approval.human_edited === true });
    await assertApproval(approval, table, checked.step, guards);
    const result = applyStep(table, checked.step);
    const event = ApplyEventSchema.parse(await sealEvent({ v: 1, seq: events.length, kind: 'apply', run_id: events[0].run_id,
      step_id: step.id, op: step.op, op_version: getOp(step.op).version, params: checked.step.params,
      params_hash: await hashCanonicalJson(checked.step.params), columns: [...step.columns], approval_ref: approval,
      input_hash: await hashTable(table), output_hash: await hashTable(result.table), prev_event_hash: events.at(-1)!.event_hash,
      ...result.delta, created_at: createdAt }));
    events.push(event); table = result.table; applied[index] = true;
  }
  return fold(input, events);
}

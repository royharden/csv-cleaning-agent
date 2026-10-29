/**
 * Plan validator (C §2.8 "Validator", spec item 5; PLAN.md M2 AC6). Pure, synchronous.
 *
 *   validatePlan(plan, ctx: {table, outboundColumnIds, excludedColumnIds}) -> {accepted, rejected, plan_reasons}
 *
 * Contract:
 *  - Input is untrusted (model output, imported file, fixture). Nothing is repaired, stripped or guessed: a step is
 *    either accepted as written (params replaced by their zod-parsed value) or rejected with every reason found.
 *  - Plan envelope: exactly `{version: 1, steps: [...]}`. A non-object or a missing `steps` array -> nothing
 *    accepted, `plan_reasons` explains. A wrong version or extra plan keys -> every step rejected (`plan_envelope`).
 *  - Steps at index >= PLAN_MAX_STEPS (32) are rejected (`too_many_steps`); the first 32 are validated normally.
 *  - Per step: closed key set {id, op, columns, params, rationale?} (extra keys such as `human_edited` rejected);
 *    id 1..64 chars of [A-Za-z0-9_.:-]; ids unique across the plan (every step sharing an id is rejected); op in
 *    the closed vocabulary; columns resolved by resolve.ts (unknown / label / excluded / not outbound / duplicate);
 *    column count within the op's arity; params pass the op's strict zod schema; rationale a string of at most
 *    2,000 characters; then the op's table check (e.g. map_categories `from`/`to` observed, rename collisions).
 *  - Predecessor table: with `chain` (default true) step k is checked against `ctx.table` after applying the
 *    ACCEPTED steps 0..k-1 in memory (same apply engine). M3 review state must re-run `validateStep` on the
 *    actual approved-only predecessor whenever a card's predecessor changes or a step is edited.
 *  - Guards are NOT validation: a guarded step is accepted here and made "unconfirmed" by guards.ts.
 */

import { OP_NAMES, PLAN_MAX_STEPS, PLAN_VERSION, RATIONALE_MAX_CHARS, STEP_ID_MAX_CHARS } from '../constants.ts';
import type { ColumnId, Table } from '../table.ts';
import { OPS, isOpName, type PlanStep, type Problem, type RejectionCode } from './registry.ts';
import { resolveColumnRefs } from './resolve.ts';
import { PLAN_KEYS, PLAN_STEP_KEYS, PLAN_STEP_REQUIRED_KEYS, STEP_ID_PATTERN, zodIssuesToProblems } from './schemas.ts';

export interface ValidationContext {
  /** The table the plan is proposed for (the predecessor of step 0). */
  readonly table: Table;
  readonly outboundColumnIds: readonly ColumnId[];
  readonly excludedColumnIds: readonly ColumnId[];
  /** Step ids whose current params come from a local human edit (provenance from the review record, M3). */
  readonly humanEditedStepIds?: readonly string[];
  /** Check each step against the table after the accepted earlier steps (default true). */
  readonly chain?: boolean;
}

export interface AcceptedStep {
  /** Position in the submitted plan. */
  readonly index: number;
  readonly step: PlanStep;
}

export interface Rejection {
  readonly index: number;
  readonly step_id?: string;
  readonly reasons: string[];
  /** One code per reason, index-aligned with `reasons`. */
  readonly codes: RejectionCode[];
}

export interface ValidationResult {
  readonly accepted: AcceptedStep[];
  readonly rejected: Rejection[];
  /** Plan-level problems (envelope, version, extra plan keys). */
  readonly plan_reasons: string[];
}

export interface StepContext {
  /** The predecessor table of this step. */
  readonly table: Table;
  readonly outboundColumnIds: readonly ColumnId[];
  readonly excludedColumnIds: readonly ColumnId[];
  readonly humanEdited?: boolean;
  /** Ids used by more than one step of the plan (precomputed by validatePlan). */
  readonly duplicateIds?: ReadonlySet<string>;
}

export type StepValidation =
  | { readonly ok: true; readonly step: PlanStep }
  | { readonly ok: false; readonly step_id?: string; readonly problems: Problem[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function extraKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

/** Validate one step against its predecessor table. */
export function validateStep(raw: unknown, ctx: StepContext): StepValidation {
  if (!isPlainObject(raw)) return { ok: false, problems: [{ code: 'not_object', message: 'step is not a JSON object' }] };
  const problems: Problem[] = [];
  const stepId = typeof raw.id === 'string' ? raw.id : undefined;

  const extras = extraKeys(raw, PLAN_STEP_KEYS);
  if (extras.length > 0) problems.push({ code: 'extra_keys', message: `extra key(s) in step: ${extras.join(', ')}` });
  for (const key of PLAN_STEP_REQUIRED_KEYS) {
    if (!(key in raw)) problems.push({ code: 'missing_field', message: `missing required field "${key}"` });
  }

  if ('id' in raw) {
    if (stepId === undefined || stepId.length === 0 || stepId.length > STEP_ID_MAX_CHARS || !STEP_ID_PATTERN.test(stepId)) {
      problems.push({
        code: 'bad_id',
        message: `id must be 1-${STEP_ID_MAX_CHARS} characters from [A-Za-z0-9_.:-]`,
      });
    } else if (ctx.duplicateIds?.has(stepId) === true) {
      problems.push({ code: 'duplicate_step_id', message: `step id ${JSON.stringify(stepId)} is used by more than one step` });
    }
  }

  const opOk = isOpName(raw.op);
  if ('op' in raw && !opOk) {
    problems.push({
      code: 'unknown_op',
      message: `unknown op ${JSON.stringify(raw.op)}; allowed: ${OP_NAMES.join(', ')}`,
    });
  }

  let columnIds: ColumnId[] | null = null;
  if ('columns' in raw) {
    if (!Array.isArray(raw.columns)) {
      problems.push({ code: 'bad_columns', message: 'columns must be an array of column ids' });
    } else {
      const resolved = resolveColumnRefs(raw.columns, ctx);
      problems.push(...resolved.problems);
      if (resolved.problems.length === 0) columnIds = resolved.ids;
      if (opOk) {
        const arity = OPS[raw.op as PlanStep['op']].arity;
        const n = raw.columns.length;
        if (n < arity.min || n > arity.max) {
          const want = arity.min === arity.max ? `exactly ${arity.min}` : `${arity.min}-${arity.max}`;
          problems.push({ code: 'arity', message: `${String(raw.op)} takes ${want} column(s), got ${n}` });
        }
      }
    }
  }

  let params: unknown;
  let paramsOk = false;
  if (opOk && 'params' in raw) {
    const parsed = OPS[raw.op as PlanStep['op']].schema.safeParse(raw.params);
    if (parsed.success) {
      params = parsed.data;
      paramsOk = true;
    } else {
      problems.push(...zodIssuesToProblems(parsed.error.issues));
    }
  }

  if ('rationale' in raw) {
    if (typeof raw.rationale !== 'string') {
      problems.push({ code: 'bad_rationale', message: 'rationale must be a string' });
    } else if (raw.rationale.length > RATIONALE_MAX_CHARS) {
      problems.push({
        code: 'rationale_too_long',
        message: `rationale has ${raw.rationale.length} characters; the limit is ${RATIONALE_MAX_CHARS}`,
      });
    }
  }

  if (problems.length > 0 || !opOk || !paramsOk || columnIds === null || stepId === undefined) {
    return { ok: false, step_id: stepId, problems };
  }

  const step: PlanStep = {
    id: stepId,
    op: raw.op as PlanStep['op'],
    columns: columnIds,
    params,
    ...(typeof raw.rationale === 'string' ? { rationale: raw.rationale } : {}),
  };
  const tableProblems = OPS[step.op].check(ctx.table, step, { humanEdited: ctx.humanEdited === true });
  if (tableProblems.length > 0) return { ok: false, step_id: stepId, problems: tableProblems };
  return { ok: true, step };
}

function rejection(index: number, stepId: string | undefined, problems: readonly Problem[]): Rejection {
  return {
    index,
    ...(stepId === undefined ? {} : { step_id: stepId }),
    reasons: problems.map((p) => p.message),
    codes: problems.map((p) => p.code),
  };
}

export function validatePlan(plan: unknown, ctx: ValidationContext): ValidationResult {
  const accepted: AcceptedStep[] = [];
  const rejected: Rejection[] = [];
  const planReasons: string[] = [];

  if (!isPlainObject(plan)) {
    return { accepted, rejected, plan_reasons: ['plan is not a JSON object {version, steps}'] };
  }
  if (!Array.isArray(plan.steps)) {
    return { accepted, rejected, plan_reasons: ['plan.steps is missing or not an array'] };
  }
  const steps: readonly unknown[] = plan.steps;
  if (plan.version !== PLAN_VERSION) planReasons.push(`plan.version must be ${PLAN_VERSION}, got ${JSON.stringify(plan.version)}`);
  const extras = extraKeys(plan, PLAN_KEYS);
  if (extras.length > 0) planReasons.push(`extra key(s) in plan: ${extras.join(', ')}`);

  const idOf = (raw: unknown): string | undefined =>
    isPlainObject(raw) && typeof raw.id === 'string' ? raw.id : undefined;

  if (planReasons.length > 0) {
    steps.forEach((raw, index) => {
      rejected.push(rejection(index, idOf(raw), [{ code: 'plan_envelope', message: `plan envelope invalid: ${planReasons.join('; ')}` }]));
    });
    return { accepted, rejected, plan_reasons: planReasons };
  }

  const idCounts = new Map<string, number>();
  steps.forEach((raw) => {
    const id = idOf(raw);
    if (id !== undefined) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  });
  const duplicateIds = new Set([...idCounts].filter(([, n]) => n > 1).map(([id]) => id));
  const humanEdited = new Set(ctx.humanEditedStepIds ?? []);
  const chain = ctx.chain !== false;
  let predecessor = ctx.table;

  steps.forEach((raw, index) => {
    const stepId = idOf(raw);
    if (index >= PLAN_MAX_STEPS) {
      rejected.push(
        rejection(index, stepId, [
          { code: 'too_many_steps', message: `plan has ${steps.length} steps; the limit is ${PLAN_MAX_STEPS} (this is step ${index + 1})` },
        ]),
      );
      return;
    }
    const result = validateStep(raw, {
      table: predecessor,
      outboundColumnIds: ctx.outboundColumnIds,
      excludedColumnIds: ctx.excludedColumnIds,
      humanEdited: stepId !== undefined && humanEdited.has(stepId),
      duplicateIds,
    });
    if (!result.ok) {
      rejected.push(rejection(index, result.step_id, result.problems));
      return;
    }
    if (chain) {
      try {
        predecessor = OPS[result.step.op].apply(predecessor, result.step).table;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        rejected.push(rejection(index, result.step.id, [{ code: 'apply_failed', message }]));
        return;
      }
    }
    accepted.push({ index, step: result.step });
  });

  return { accepted, rejected, plan_reasons: planReasons };
}

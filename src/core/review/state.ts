import { PLAN_MAX_STEPS, type GuardId } from '../constants.ts';
import { canonicalJson } from '../journal/canonical.ts';
import { hashCanonicalJson, hashTable } from '../journal/hash.ts';
import type { ApprovedPlan } from '../journal/apply.ts';
import type { ColumnId, Table } from '../table.ts';
import { evaluateGuards, type GuardHit } from '../transformkit/guards.ts';
import { previewOne, type PlanStep, type StepPreview } from '../transformkit/registry.ts';
import { validatePlan, validateStep } from '../transformkit/validator.ts';
import { createApproval, type Approval } from './approvals.ts';
import { replayRuling } from '../rulings/rulings.ts';

export type DecisionKind = 'pending' | 'approved' | 'rejected' | 'stale';
export interface Decision {
  readonly kind: DecisionKind;
  readonly humanEdited: boolean;
  readonly confirmations: readonly GuardId[];
  readonly approval?: Approval;
  readonly reason?: string;
}
export interface ReviewCard {
  readonly index: number;
  readonly raw: unknown;
  readonly step?: PlanStep;
  readonly status: DecisionKind | 'unconfirmed' | 'invalid';
  readonly decision: Decision;
  readonly predecessor: Table;
  readonly predecessor_hash: string;
  readonly params_hash?: string;
  readonly guards: readonly GuardHit[];
  readonly preview?: StepPreview;
  readonly reasons: readonly string[];
}
export interface ReviewState {
  readonly input: Table;
  readonly rawSteps: readonly unknown[];
  readonly decisions: readonly Decision[];
  readonly cards: readonly ReviewCard[];
  readonly final: Table;
  readonly outboundColumnIds: readonly ColumnId[];
  readonly excludedColumnIds: readonly ColumnId[];
}
export interface ReviewScope { readonly outboundColumnIds: readonly ColumnId[]; readonly excludedColumnIds: readonly ColumnId[] }
const pending = (): Decision => ({ kind: 'pending', humanEdited: false, confirmations: [] });
function idOf(raw: unknown): string | undefined {
  return raw !== null && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string' ? raw.id : undefined;
}

export async function createReviewState(input: Table, plan: unknown, scope: ReviewScope): Promise<ReviewState> {
  const validated = validatePlan(plan, { table: input, ...scope, chain: false });
  if (validated.plan_reasons.length > 0) throw new Error(validated.plan_reasons.join('; '));
  const rawSteps = (plan as { steps: unknown[] }).steps;
  return refreshReview({ input, rawSteps, decisions: rawSteps.map(pending), cards: [], final: input, ...scope });
}

/** The only state recomputation: validate and preview against approved predecessors, never tentative cards. */
export async function refreshReview(state: ReviewState): Promise<ReviewState> {
  let table = state.input;
  const cards: ReviewCard[] = [];
  const decisions: Decision[] = [];
  const counts = new Map<string, number>();
  state.rawSteps.forEach((raw) => { const id = idOf(raw); if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1); });
  const duplicateIds = new Set([...counts].filter(([, n]) => n > 1).map(([id]) => id));
  // Guards require the complete valid vocabulary plan, including rejected future trim cards.
  const contextSteps = state.rawSteps.flatMap((raw, i) => {
    const check = validateStep(raw, { table: state.input, ...state, humanEdited: state.decisions[i]?.humanEdited, duplicateIds });
    return check.ok ? [check.step] : [];
  });
  for (let index = 0; index < state.rawSteps.length; index += 1) {
    const raw = state.rawSteps[index];
    let decision = state.decisions[index] ?? pending();
    const predecessorHash = await hashTable(table);
    const checked = validateStep(raw, { table, ...state, humanEdited: decision.humanEdited, duplicateIds });
    if (!checked.ok || index >= PLAN_MAX_STEPS) {
      if (decision.kind === 'approved') decision = { kind: 'stale', humanEdited: decision.humanEdited, confirmations: [] };
      cards.push({ index, raw, status: decision.kind === 'rejected' ? 'rejected' : 'invalid', decision,
        predecessor: table, predecessor_hash: predecessorHash, guards: [],
        reasons: index >= PLAN_MAX_STEPS ? [`plan limit is ${PLAN_MAX_STEPS} steps`] : !checked.ok ? checked.problems.map((p) => p.message) : [] });
      decisions.push(decision); continue;
    }
    const step = checked.step;
    const paramsHash = await hashCanonicalJson(step.params);
    const contextIndex = contextSteps.findIndex((s) => s.id === step.id);
    const guardSteps = contextIndex < 0 ? [...contextSteps, step] : contextSteps;
    const guards = evaluateGuards(table, step, { steps: guardSteps, index: contextIndex < 0 ? guardSteps.length - 1 : contextIndex,
      applied: guardSteps.map((s) => cards.some((c) => c.step?.id === s.id && c.status === 'approved')), humanEdited: decision.humanEdited });
    if (decision.kind === 'approved' && (decision.approval?.params_hash !== paramsHash || decision.approval.predecessor_hash !== predecessorHash ||
      guards.some((g) => !decision.approval?.guard_confirmations.includes(g.guard)))) {
      decision = { kind: 'stale', humanEdited: decision.humanEdited, confirmations: [] };
    }
    const preview = previewOne(table, step);
    const status = decision.kind === 'pending' && guards.some((g) => !decision.confirmations.includes(g.guard)) ? 'unconfirmed' : decision.kind;
    cards.push({ index, raw, step, status, decision, predecessor: table, predecessor_hash: predecessorHash,
      params_hash: paramsHash, guards, preview, reasons: [] });
    decisions.push(decision);
    if (status === 'approved') table = preview.result.table;
  }
  return { ...state, cards, decisions, final: table };
}

export type ReviewAction =
  | { readonly type: 'approve'; readonly index: number; readonly decidedAt: string }
  | { readonly type: 'reject'; readonly index: number; readonly reason: string }
  | { readonly type: 'confirm'; readonly index: number; readonly guard: GuardId }
  | { readonly type: 'edit'; readonly index: number; readonly step: unknown };

export async function decide(state: ReviewState, action: ReviewAction): Promise<ReviewState> {
  const fresh = await refreshReview(state);
  const card = fresh.cards[action.index];
  if (card === undefined) throw new Error(`unknown review card ${action.index}`);
  const decisions = [...fresh.decisions];
  const rawSteps = [...fresh.rawSteps];
  if (action.type === 'approve') {
    const earlier = fresh.cards.find((c) => c.index < action.index && !['approved', 'rejected', 'invalid'].includes(c.status));
    if (earlier !== undefined) throw new Error(`decide step ${earlier.index + 1} first`);
    if (card.step === undefined || card.reasons.length > 0) throw new Error('invalid step must be edited or rejected');
    const approval = await createApproval(card.predecessor, card.step, card.guards, card.decision.confirmations, action.decidedAt, card.decision.humanEdited);
    decisions[action.index] = { ...card.decision, kind: 'approved', approval };
  } else if (action.type === 'reject') {
    if (action.reason.trim().length === 0) throw new Error('rejection requires a reason');
    decisions[action.index] = { kind: 'rejected', reason: action.reason, humanEdited: card.decision.humanEdited, confirmations: [] };
  } else if (action.type === 'confirm') {
    if (!card.guards.some((g) => g.guard === action.guard)) throw new Error(`guard ${action.guard} is not active`);
    decisions[action.index] = { ...card.decision, kind: card.status === 'approved' ? 'pending' : card.decision.kind,
      approval: undefined, confirmations: [...new Set([...card.decision.confirmations, action.guard])] };
  } else {
    // A new edit must preserve identity; revalidation handles all untrusted fields, including human_edited.
    if (idOf(action.step) !== idOf(card.raw)) throw new Error('editing a step must preserve its id');
    if (canonicalJson(action.step) === canonicalJson(card.raw)) return fresh;
    rawSteps[action.index] = action.step;
    decisions[action.index] = { kind: 'pending', humanEdited: true, confirmations: [] };
  }
  return refreshReview({ ...fresh, decisions, rawSteps });
}

export function approvedPlan(state: ReviewState): ApprovedPlan {
  const unresolved = state.cards.find((card) => ['pending', 'stale', 'unconfirmed'].includes(card.status));
  if (unresolved !== undefined) throw new Error(`decide step ${unresolved.index + 1} first`);
  return { steps: state.cards.flatMap((card) => card.step === undefined ? [] : [card.step]),
    approvals: state.cards.flatMap((card) => card.status === 'approved' && card.decision.approval !== undefined ? [card.decision.approval] : []),
    outboundColumnIds: state.outboundColumnIds, excludedColumnIds: state.excludedColumnIds };
}

/** Replay rejection reasons in order, recomputing each predecessor after preceding decisions. */
export async function replayRulings(state: ReviewState, records: readonly unknown[]): Promise<ReviewState> {
  let next = await refreshReview(state);
  for (let index = 0; index < next.cards.length; index += 1) {
    const card = next.cards[index];
    if (card.step === undefined || card.status === 'approved') continue;
    const replay = await replayRuling(card.predecessor, card.step, records);
    if (replay !== null) next = await decide(next, { type: 'reject', index, reason: replay.reason });
  }
  return next;
}

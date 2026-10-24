/**
 * Preview engine (spec item 6; C §2.5 "Preview chain"; PLAN.md row 8). Pure, synchronous.
 *
 * Contract:
 *  - `previewStep(table, step)` = the op's own `apply` run in memory on that table plus review samples. There is no
 *    separate approximation, so a displayed preview is exactly what Apply would produce on the same predecessor.
 *  - `previewChain(base, steps, inEffect)` previews every step k on the table after the steps j < k with
 *    `inEffect[j] === true` (M3 passes "approved"; PLAN.md row 8: preview basis = approved earlier steps only).
 *    Steps not in effect (pending, rejected) still get a provisional preview on that same state, but never change
 *    it. Each entry carries its predecessor table (M3 hashes it for the approval binding) and the guard hits on
 *    that predecessor. A step whose apply throws gets `error` instead of a preview and never changes the state.
 *  - Nothing here is async; hashing (WebCrypto) is the caller's job.
 */

import type { Table } from '../table.ts';
import { evaluateGuards, type GuardHit } from './guards.ts';
import { getOp, type PlanStep, type StepPreview } from './registry.ts';

export interface ChainEntry {
  readonly index: number;
  readonly step_id: string;
  readonly in_effect: boolean;
  /** The table this step runs on. */
  readonly predecessor: Table;
  readonly preview: StepPreview | null;
  readonly guards: readonly GuardHit[];
  readonly error?: string;
}

export interface Chain {
  readonly entries: readonly ChainEntry[];
  /** The table after every in-effect step (what Apply would produce). */
  readonly final: Table;
}

export function previewStep(table: Table, step: PlanStep): StepPreview {
  return getOp(step.op).preview(table, step);
}

export function previewChain(
  base: Table,
  steps: readonly PlanStep[],
  inEffect: readonly boolean[],
  humanEditedStepIds: readonly string[] = [],
): Chain {
  const edited = new Set(humanEditedStepIds);
  const entries: ChainEntry[] = [];
  let state = base;
  steps.forEach((step, index) => {
    const effective = inEffect[index] === true;
    const guards = evaluateGuards(state, step, {
      steps,
      index,
      applied: inEffect,
      humanEdited: edited.has(step.id),
    });
    try {
      const preview = previewStep(state, step);
      entries.push({ index, step_id: step.id, in_effect: effective, predecessor: state, preview, guards });
      if (effective) state = preview.result.table;
    } catch (error) {
      entries.push({
        index,
        step_id: step.id,
        in_effect: effective,
        predecessor: state,
        preview: null,
        guards,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return { entries, final: state };
}

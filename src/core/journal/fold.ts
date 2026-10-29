import { canonicalJson } from './canonical.ts';
import { EventSchema, eventHash, type ApplyEvent, type JournalEvent } from './events.ts';
import { hashCanonicalJson, hashTable } from './hash.ts';
import { assertApproval } from '../review/approvals.ts';
import { assertValidTable, tablesEqual, type Table } from '../table.ts';
import { applyDelta } from '../transformkit/delta.ts';
import { applyStep, getOp, invertStep, type PlanStep, type StepDelta } from '../transformkit/registry.ts';
import { validateStep } from '../transformkit/validator.ts';
import { evaluateGuards } from '../transformkit/guards.ts';

export class JournalError extends Error {
  readonly eventIndex: number;
  readonly field: string;
  constructor(eventIndex: number, field: string, message: string) {
    super(`event ${eventIndex} ${field}: ${message}`);
    this.name = 'JournalError'; this.eventIndex = eventIndex; this.field = field;
  }
}
export function requireField(condition: boolean, index: number, field: string, message: string): asserts condition {
  if (!condition) throw new JournalError(index, field, message);
}
export function eventDelta(event: ApplyEvent): StepDelta {
  return { changes: event.changes, ...(event.dropped === undefined ? {} : { dropped: event.dropped }),
    ...(event.header_change === undefined ? {} : { header_change: event.header_change }),
    ...(event.mapping === undefined ? {} : { mapping: event.mapping }) };
}
export function eventStep(event: ApplyEvent): PlanStep {
  return { id: event.step_id, op: event.op, columns: event.columns, params: event.params };
}
export interface FoldResult {
  readonly table: Table;
  readonly active: readonly ApplyEvent[];
  readonly events: readonly JournalEvent[];
}

/** Validate schemas, chain, op replay, recorded deltas and exact LIFO inverses before returning state. */
export async function fold(input: Table, rawEvents: readonly unknown[]): Promise<FoldResult> {
  assertValidTable(input);
  requireField(rawEvents.length > 0, 0, 'kind', 'journal has no genesis');
  let table = input;
  const active: ApplyEvent[] = [];
  const events: JournalEvent[] = [];
  for (let index = 0; index < rawEvents.length; index += 1) {
    const parsed = EventSchema.safeParse(rawEvents[index]);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new JournalError(index, issue.path.join('.') || 'schema', issue.message);
    }
    const event = parsed.data as JournalEvent;
    requireField(event.seq === index, index, 'seq', `expected ${index}`);
    requireField(event.event_hash === await eventHash(event), index, 'event_hash', 'canonical event digest mismatch');
    if (index === 0) {
      requireField(event.kind === 'genesis', index, 'kind', 'first event must be genesis');
      requireField(event.input_hash === await hashTable(input), index, 'input_hash', 'input table digest mismatch');
      requireField(event.parse.records === input.rows.length && event.parse.columns === input.cols.length, index, 'parse', 'dimensions mismatch');
      events.push(event); continue;
    }
    requireField(event.kind !== 'genesis', index, 'kind', 'only one genesis is allowed');
    requireField(event.run_id === events[0].run_id, index, 'run_id', 'run changed');
    requireField(event.prev_event_hash === events[index - 1].event_hash, index, 'prev_event_hash', 'chain mismatch');
    requireField(event.input_hash === await hashTable(table), index, 'input_hash', 'predecessor digest mismatch');
    if (event.kind === 'apply') {
      requireField(event.op_version === getOp(event.op).version, index, 'op_version', 'unsupported op version');
      requireField(event.params_hash === await hashCanonicalJson(event.params), index, 'params_hash', 'params digest mismatch');
      const checked = validateStep(eventStep(event), { table, outboundColumnIds: table.cols.map((c) => c.id),
        excludedColumnIds: [], humanEdited: event.approval_ref.human_edited === true });
      requireField(checked.ok, index, 'params', checked.ok ? '' : checked.problems.map((p) => p.message).join('; '));
      requireField(canonicalJson(checked.step.params) === canonicalJson(event.params), index, 'params', 'params must be complete canonical validated params');
      const guardSteps = [...active.map(eventStep), checked.step];
      const guards = evaluateGuards(table, checked.step, { steps: guardSteps, index: guardSteps.length - 1,
        applied: guardSteps.map(() => true), humanEdited: event.approval_ref.human_edited === true });
      try { await assertApproval(event.approval_ref, table, checked.step, guards); }
      catch (error) { throw new JournalError(index, 'approval_ref', error instanceof Error ? error.message : String(error)); }
      try {
        const replay = applyStep(table, checked.step);
        requireField(canonicalJson(eventDelta(event)) === canonicalJson(replay.delta), index, 'delta', 'recorded changes differ from op replay');
        const recorded = applyDelta(table, eventDelta(event));
        requireField(tablesEqual(recorded, replay.table), index, 'delta', 'delta and op disagree');
        table = recorded;
      } catch (error) {
        if (error instanceof JournalError) throw error;
        throw new JournalError(index, 'delta', error instanceof Error ? error.message : String(error));
      }
      active.push(event);
    } else {
      const tip = active.at(-1);
      requireField(tip !== undefined, index, 'undo_of', 'no undoable apply event');
      requireField(event.undo_of.seq === tip.seq && event.undo_of.event_hash === tip.event_hash && event.undo_of.step_id === tip.step_id,
        index, 'undo_of', 'must name the current undoable tip');
      try { table = invertStep(table, eventDelta(tip)); }
      catch (error) { throw new JournalError(index, 'undo_of', error instanceof Error ? error.message : String(error)); }
      requireField(event.output_hash === tip.input_hash, index, 'output_hash', 'undo must restore the target input hash');
      active.pop();
    }
    assertValidTable(table);
    requireField(event.output_hash === await hashTable(table), index, 'output_hash', 'folded table digest mismatch');
    events.push(event);
  }
  if (active.length === 0) requireField(tablesEqual(table, input), events.length - 1, 'output_hash', 'full undo must restore input exactly');
  return { table, active, events };
}

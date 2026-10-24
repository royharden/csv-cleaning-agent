import sampleUrl from '../../fixtures/demo/orders-demo.csv?url';
import { MAX_INPUT_BYTES } from '../core/constants.ts';
import { parseBytes, type ParseMeta } from '../core/csv/parse.ts';
import { encodeTable, exportOptionsFromMeta } from '../core/csv/serialize.ts';
import { apply } from '../core/journal/apply.ts';
import { createGenesis, serializeJournal, type ApplyEvent, type JournalEvent } from '../core/journal/events.ts';
import { fold } from '../core/journal/fold.ts';
import { hashTable } from '../core/journal/hash.ts';
import { invariant, type InvariantReport } from '../core/journal/invariant.ts';
import { undoAll, undoLast, undoTo } from '../core/journal/undo.ts';
import { exportPlan, importPlan } from '../core/plan/io.ts';
import { hashOutboundProfile, loadFixture } from '../core/planners/fixture.ts';
import { createRulesPlanner } from '../core/planners/rules.ts';
import { buildOutboundProfile, type OutboundBuild } from '../core/profile/outbound.ts';
import { buildLocalProfile, type LocalProfile } from '../core/profile/profile.ts';
import { approvedPlan, createReviewState, decide, refreshReview, replayRulings, type ReviewAction, type ReviewState } from '../core/review/state.ts';
import { createRuling, parseRulings, serializeRulings, type Ruling } from '../core/rulings/rulings.ts';
import type { ColumnId, Table } from '../core/table.ts';
import { loadSession, saveSession, type SavedSession } from '../store/idb.ts';

export type ExportKind = 'cleaned' | 'journal' | 'plan' | 'rulings' | 'original';
export type PlannerChoice = 'rules' | 'fixture';
export interface Session {
  readonly filename: string;
  readonly original: Blob;
  readonly input: Table;
  readonly meta: ParseMeta;
  readonly table: Table;
  readonly acknowledged: boolean;
  readonly excluded: readonly ColumnId[];
  readonly local: LocalProfile;
  readonly outbound: OutboundBuild;
  readonly events: readonly JournalEvent[];
  readonly active: readonly ApplyEvent[];
  readonly rulings: readonly Ruling[];
  readonly review?: ReviewState;
  readonly source: string;
  readonly notes: readonly string[];
  readonly outputHash: string;
  readonly reviewBaseHash?: string;
  readonly report: InvariantReport;
}
export interface AppState {
  readonly busy: boolean;
  readonly ready: boolean;
  readonly error?: string;
  readonly session?: Session;
}
const fixtureModules = import.meta.glob<{ default: unknown }>('/fixtures/plans/*.json', { eager: true });
const fixtureRecords: readonly unknown[] = Object.values(fixtureModules).map((module) => module.default);
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const now = (): string => new Date().toISOString();

export function applyBlockReason(session: Session | undefined): string | undefined {
  if (session === undefined) return 'Load a file first.';
  if (!session.acknowledged) return 'Acknowledge the validation report before Apply.';
  if (session.review === undefined) return 'Generate or import a plan first.';
  if (session.reviewBaseHash !== session.outputHash) return 'The journal state changed. Undo back to the review input or generate a fresh plan.';
  try {
    const plan = approvedPlan(session.review);
    if (plan.approvals.length === 0) return 'Approve at least one valid step before Apply.';
  } catch (error) { return message(error); }
  return undefined;
}

function saved(session: Session): SavedSession {
  const { filename, original, input, meta, acknowledged, excluded, events, rulings, review, source, notes } = session;
  return { version: 1, filename, original, input, meta, acknowledged, excluded, events, rulings, source, notes,
    ...(review === undefined ? {} : { review: { input: review.input, rawSteps: review.rawSteps, decisions: review.decisions,
      outboundColumnIds: review.outboundColumnIds, excludedColumnIds: review.excludedColumnIds } }) };
}

async function derive(record: SavedSession, review?: ReviewState): Promise<Session> {
  const folded = await fold(record.input, record.events);
  const local = buildLocalProfile(folded.table);
  const outbound = buildOutboundProfile(folded.table, local, { excludedColumnIds: record.excluded });
  return { ...record, table: folded.table, active: folded.active, events: folded.events, local, outbound,
    review, outputHash: await hashTable(folded.table),
    reviewBaseHash: review === undefined ? undefined : await hashTable(review.input),
    report: await invariant(record.input, folded.events, folded.table) };
}

/** All asynchronous user intents share one queue. Publish only after the candidate snapshot is durable. */
export class AppController {
  private state: AppState = { busy: false, ready: false };
  private readonly listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;
  readonly getSnapshot = (): AppState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(state: AppState): void { this.state = state; this.listeners.forEach((listener) => listener()); }
  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(async () => {
      this.publish({ ...this.state, busy: true, error: undefined });
      try { await work(); }
      catch (error) { this.publish({ ...this.state, error: message(error) }); }
      finally { this.publish({ ...this.state, busy: false, ready: true }); }
    });
    this.queue = next;
    return next;
  }
  private requireSession(): Session {
    if (this.state.session === undefined) throw new Error('Load a CSV or TSV first.');
    return this.state.session;
  }
  private async commit(session: Session): Promise<void> {
    await saveSession(saved(session));
    this.publish({ ...this.state, session, error: undefined });
  }
  initialize(): Promise<void> {
    if (this.initialized) return this.queue;
    this.initialized = true;
    return this.enqueue(async () => {
      const record = await loadSession();
      if (record === null) return;
      const original = parseBytes(await record.original.arrayBuffer());
      if (!original.ok) throw new Error(`Saved original cannot be parsed: ${original.error.message}`);
      if (await hashTable(original.table) !== await hashTable(record.input)) throw new Error('Saved original and input table differ.');
      const rulings = parseRulings(serializeRulings(record.rulings));
      let review: ReviewState | undefined;
      if (record.review !== undefined) {
        const base = await createReviewState(record.review.input, { version: 1, steps: record.review.rawSteps }, record.review);
        review = await refreshReview({ ...base, decisions: record.review.decisions });
      }
      const session = await derive({ ...record, rulings }, review);
      this.publish({ ...this.state, session });
    });
  }
  private async acceptBytes(filename: string, bytes: ArrayBuffer): Promise<void> {
    const parsed = parseBytes(bytes);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const genesis = await createGenesis(parsed.table, parsed.meta, crypto.randomUUID(), now());
    const record: SavedSession = { version: 1, filename, original: new Blob([bytes], { type: 'text/csv' }),
      input: parsed.table, meta: parsed.meta, acknowledged: false, excluded: [], events: [genesis],
      rulings: this.state.session?.rulings ?? [], source: 'No plan yet', notes: [] };
    await this.commit(await derive(record));
  }
  loadFile(file: File): Promise<void> {
    return this.enqueue(async () => {
      if (file.size > MAX_INPUT_BYTES) throw new Error(`File exceeds the ${MAX_INPUT_BYTES.toLocaleString('en-US')}-byte cap.`);
      await this.acceptBytes(file.name, await file.arrayBuffer());
    });
  }
  loadSample(): Promise<void> {
    return this.enqueue(async () => {
      const response = await fetch(sampleUrl);
      if (!response.ok) throw new Error(`Cannot load bundled sample (${response.status}).`);
      await this.acceptBytes('orders-demo.csv', await response.arrayBuffer());
    });
  }
  acknowledge(value: boolean): Promise<void> {
    return this.enqueue(async () => { await this.commit({ ...this.requireSession(), acknowledged: value }); });
  }
  toggleColumn(id: ColumnId): Promise<void> {
    return this.enqueue(async () => {
      const session = this.requireSession();
      if (!session.table.cols.some((column) => column.id === id)) throw new Error(`Unknown column ${id}.`);
      const excluded = session.excluded.includes(id) ? session.excluded.filter((value) => value !== id) : [...session.excluded, id];
      await this.commit(await derive({ ...saved(session), excluded, source: 'Scope changed; generate a new plan', notes: [] }));
    });
  }
  plan(choice: PlannerChoice): Promise<void> {
    return this.enqueue(async () => {
      const session = this.requireSession();
      if (!session.outbound.fits) throw new Error('Outbound profile exceeds the body allowance. Exclude more columns.');
      let steps: readonly unknown[];
      let source: string;
      let notes: readonly string[];
      if (choice === 'rules') {
        const result = await createRulesPlanner(session.table).plan(session.outbound.profile, session.local);
        steps = result.steps; source = result.source; notes = result.notes ?? [];
      } else {
        const fixture = loadFixture(fixtureRecords, 'llm', await hashOutboundProfile(session.outbound.profile));
        if (fixture.planner !== 'llm') throw new Error('Expected llm fixture steps.');
        steps = fixture.steps; source = `${fixture.source} (${fixture.fixture_id})`;
        notes = ['Synthetic replay, not a live model call.'];
      }
      const base = await createReviewState(session.table, { version: 1, steps }, {
        outboundColumnIds: session.outbound.column_ids, excludedColumnIds: session.excluded });
      const review = await replayRulings(base, session.rulings);
      await this.commit({ ...session, source, notes, review, reviewBaseHash: session.outputHash });
    });
  }
  reviewAction(action: ReviewAction): Promise<void> {
    return this.enqueue(async () => {
      const session = this.requireSession();
      if (session.review === undefined) throw new Error('No plan to review.');
      const card = session.review.cards[action.index];
      const review = await decide(session.review, action);
      let rulings = session.rulings;
      if (action.type === 'reject' && card?.step !== undefined) rulings = [...rulings, await createRuling(
        card.predecessor, card.step, action.reason, now(), card.decision.humanEdited)];
      await this.commit({ ...session, review, rulings });
    });
  }
  apply(): Promise<void> {
    return this.enqueue(async () => {
      const session = this.requireSession();
      const blocked = applyBlockReason(session);
      if (blocked !== undefined) throw new Error(blocked);
      const review = session.review!;
      const result = await apply(session.input, session.events, approvedPlan(review), now());
      await this.commit(await derive({ ...saved(session), events: result.events }, review));
    });
  }
  undo(kind: 'last' | 'all' | number): Promise<void> {
    return this.enqueue(async () => {
      const session = this.requireSession();
      const result = typeof kind === 'number' ? await undoTo(session.input, session.events, kind, now())
        : kind === 'all' ? await undoAll(session.input, session.events, now()) : await undoLast(session.input, session.events, now());
      await this.commit(await derive({ ...saved(session), events: result.events }, session.review));
    });
  }
  importPlan(file: File): Promise<void> {
    return this.enqueue(async () => {
      const session = this.requireSession();
      if (file.size > MAX_INPUT_BYTES) throw new Error('Plan file exceeds the local import byte cap.');
      const imported = importPlan(await file.text(), session.table, session.excluded);
      const notes = [...imported.validation.plan_reasons,
        ...imported.validation.rejected.map((item) => `Imported step ${item.index + 1}: ${item.reasons.join('; ')}`),
        ...imported.resolution_rejections.map((item) => `Imported step ${item.index + 1}: ${item.reason}`)];
      const base = await createReviewState(session.table, imported.plan, {
        outboundColumnIds: session.outbound.column_ids, excludedColumnIds: session.excluded });
      const review = await replayRulings(base, session.rulings);
      await this.commit({ ...session, source: 'Imported plan; approvals reset', notes, review, reviewBaseHash: session.outputHash });
    });
  }
  importRulings(file: File): Promise<void> {
    return this.enqueue(async () => {
      const session = this.requireSession();
      if (file.size > MAX_INPUT_BYTES) throw new Error('Rulings file exceeds the local import byte cap.');
      const rulings = [...session.rulings, ...parseRulings(await file.text())];
      const review = session.review === undefined ? undefined : await replayRulings(session.review, rulings);
      await this.commit({ ...session, rulings, review });
    });
  }
  export(kind: ExportKind): Promise<void> {
    return this.enqueue(async () => {
      const session = this.requireSession();
      let blob: Blob;
      let filename: string;
      if (kind === 'original') { blob = session.original; filename = session.filename; }
      else if (kind === 'cleaned') {
        const bytes = encodeTable(session.table, exportOptionsFromMeta(session.meta));
        blob = new Blob([new Uint8Array(bytes)], { type: 'text/csv;charset=utf-8' }); filename = 'cleaned.csv';
      } else if (kind === 'journal') {
        blob = new Blob([serializeJournal(session.events)], { type: 'application/x-ndjson' }); filename = 'journal.jsonl';
      } else if (kind === 'rulings') {
        blob = new Blob([serializeRulings(session.rulings)], { type: 'application/x-ndjson' }); filename = 'rulings.jsonl';
      } else {
        if (session.review === undefined) throw new Error('No reviewed plan to export.');
        const plan = approvedPlan(session.review);
        const approvedIds = new Set(plan.approvals.map((approval) => approval.step_id));
        blob = new Blob([exportPlan({ version: 1, steps: plan.steps.filter((step) => approvedIds.has(step.id)) }, session.input)],
          { type: 'application/json' }); filename = 'plan.json';
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = filename;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
    });
  }
}

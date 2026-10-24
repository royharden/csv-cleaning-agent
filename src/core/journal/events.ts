import { z } from 'zod';
import { DELIMITERS, ENCODINGS, OP_NAMES, TERMINATORS, VOCABULARY_VERSION } from '../constants.ts';
import type { ParseMeta } from '../csv/parse.ts';
import { ApprovalSchema, HashSchema } from '../review/approvals.ts';
import { isColumnId, type Table } from '../table.ts';
import type { StepDelta } from '../transformkit/registry.ts';
import { hashCanonicalJson, hashTable } from './hash.ts';

const integer = z.number().int().nonnegative().safe();
const column = z.string().refine(isColumnId, 'expected ColumnId c0..c59');
const strings = z.array(z.string());
const changes = z.object({ rid: z.array(integer), col: z.array(column), old: strings, new: strings }).strict()
  .refine((v) => [v.col, v.old, v.new].every((a) => a.length === v.rid.length), 'changes arrays must align')
  .refine((v) => new Set(v.rid.map((rid, i) => `${rid}:${v.col[i]}`)).size === v.rid.length, 'duplicate cell coordinate')
  .refine((v) => v.old.every((old, i) => old !== v.new[i]), 'changes must change a value');
const dropped = z.object({ rid: z.array(integer), rows: z.array(strings), positions: z.array(integer) }).strict()
  .refine((v) => v.rid.length === v.rows.length && v.rid.length === v.positions.length, 'dropped arrays must align')
  .refine((v) => new Set(v.rid).size === v.rid.length && v.positions.every((p, i) => i === 0 || p > v.positions[i - 1]), 'dropped rows must be unique, positions ascending');
const headerChange = z.object({ id: z.array(column), old: strings, new: strings }).strict()
  .refine((v) => v.id.length === v.old.length && v.id.length === v.new.length && new Set(v.id).size === v.id.length, 'header arrays must align and ids be unique');
const mapping = z.object({ column, pairs: z.array(z.tuple([z.string(), z.string()])) }).strict();
export const ParseRecordSchema = z.object({
  encoding: z.enum(ENCODINGS), bom: z.boolean(), delimiter: z.enum(DELIMITERS), terminator: z.enum(TERMINATORS),
  records: integer.max(20_000), columns: integer.max(60),
  ragged: z.object({ count: integer, first: z.array(z.object({ rid: integer, width: integer.max(60) }).strict()).max(5) }).strict(),
}).strict();
export type ParseRecord = z.infer<typeof ParseRecordSchema>;
const common = { v: z.literal(1), seq: integer, run_id: z.string().min(1), event_hash: HashSchema, created_at: z.string().datetime() };
export const GenesisSchema = z.object({ ...common, seq: z.literal(0), kind: z.literal('genesis'), input_hash: HashSchema,
  parse: ParseRecordSchema, vocabulary_version: z.literal(VOCABULARY_VERSION), prev_event_hash: z.null() }).strict();
export const ApplyEventSchema = z.object({ ...common, kind: z.literal('apply'), step_id: z.string().min(1).max(64),
  op: z.enum(OP_NAMES), op_version: integer.positive(), params: z.unknown().refine((v) => v !== undefined, 'params required'),
  params_hash: HashSchema, columns: z.array(column), approval_ref: ApprovalSchema,
  input_hash: HashSchema, output_hash: HashSchema, prev_event_hash: HashSchema,
  changes, dropped: dropped.optional(), header_change: headerChange.optional(), mapping: mapping.optional(),
}).strict();
export const UndoEventSchema = z.object({ ...common, kind: z.literal('undo'),
  undo_of: z.object({ seq: integer.positive(), event_hash: HashSchema, step_id: z.string().min(1) }).strict(),
  input_hash: HashSchema, output_hash: HashSchema, prev_event_hash: HashSchema,
}).strict();
export const EventSchema = z.discriminatedUnion('kind', [GenesisSchema, ApplyEventSchema, UndoEventSchema]);
export type GenesisEvent = z.infer<typeof GenesisSchema>;
export type ApplyEvent = z.infer<typeof ApplyEventSchema> & StepDelta;
export type UndoEvent = z.infer<typeof UndoEventSchema>;
export type JournalEvent = GenesisEvent | ApplyEvent | UndoEvent;

export function parseRecord(meta: ParseMeta): ParseRecord {
  return ParseRecordSchema.parse({ encoding: meta.encoding, bom: meta.bom, delimiter: meta.delimiter,
    terminator: meta.terminator, records: meta.records, columns: meta.columns, ragged: meta.ragged });
}

export async function eventHash(event: unknown): Promise<string> {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) throw new Error('event must be an object');
  const { event_hash: _hash, ...body } = event as Record<string, unknown>;
  return hashCanonicalJson(body);
}

export async function sealEvent<T extends object>(body: T): Promise<T & { event_hash: string }> {
  return { ...body, event_hash: await eventHash(body) };
}

export async function createGenesis(table: Table, meta: ParseMeta, runId: string, createdAt: string): Promise<GenesisEvent> {
  return GenesisSchema.parse(await sealEvent({ v: 1, seq: 0, kind: 'genesis', run_id: runId,
    input_hash: await hashTable(table), parse: parseRecord(meta), vocabulary_version: VOCABULARY_VERSION,
    prev_event_hash: null, created_at: createdAt }));
}

export function parseJournal(text: string): JournalEvent[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines.map((line, index) => {
    try { return EventSchema.parse(JSON.parse(line)) as JournalEvent; }
    catch (error) { throw new Error(`event ${index} schema: ${error instanceof Error ? error.message : String(error)}`); }
  });
}

export function serializeJournal(events: readonly JournalEvent[]): string {
  return events.map((event) => JSON.stringify(EventSchema.parse(event))).join('\n') + '\n';
}

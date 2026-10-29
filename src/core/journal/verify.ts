import { parseBytes } from '../csv/parse.ts';
import { tablesEqual, type Table } from '../table.ts';
import { canonicalJson } from './canonical.ts';
import { EventSchema, parseJournal, parseRecord } from './events.ts';
import { fold, JournalError, requireField } from './fold.ts';
import { hashTable } from './hash.ts';

export interface VerifyResult { readonly ok: true; readonly events: number; readonly output_hash: string; readonly table: Table }

/** Consistency verification, not authenticity: a complete malicious rewrite can compute new hashes. */
export async function verify(journalText: string, inputBytes: Uint8Array, outputBytes: Uint8Array): Promise<VerifyResult> {
  const events = parseJournal(journalText);
  const first = EventSchema.safeParse(events[0]);
  requireField(first.success && first.data.kind === 'genesis', 0, 'kind', 'journal must begin with genesis');
  const genesis = first.data;
  // Respect the recorded user-selected delimiter. Every other recorded parse field is independently recomputed.
  const input = parseBytes(inputBytes, { delimiter: genesis.parse.delimiter });
  if (!input.ok) throw new JournalError(0, 'parse', input.error.message);
  const measured = parseRecord(input.meta);
  for (const key of Object.keys(measured) as (keyof typeof measured)[]) {
    requireField(canonicalJson(measured[key]) === canonicalJson(genesis.parse[key]), 0, `parse.${key}`, 'input metadata mismatch');
  }
  const result = await fold(input.table, events);
  const index = events.length - 1;
  const output = parseBytes(outputBytes, { delimiter: genesis.parse.delimiter });
  if (!output.ok) throw new JournalError(index, 'output.csv', output.error.message);
  requireField(output.meta.encoding === 'utf-8', index, 'output.csv.encoding', 'cleaned export must be UTF-8');
  requireField(output.table.rows.length === result.table.rows.length, index, 'output.csv.rows', 'record count mismatch');
  const aligned: Table = { ...output.table, rid: [...result.table.rid] };
  requireField(tablesEqual(aligned, result.table), index, 'output.csv', 'headers, cells, widths or row order differ from folded journal');
  requireField(await hashTable(aligned) === await hashTable(result.table), index, 'output_hash', 'output digest mismatch');
  return { ok: true, events: events.length, output_hash: await hashTable(result.table), table: result.table };
}

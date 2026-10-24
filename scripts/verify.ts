import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { verify } from '../src/core/journal/verify.ts';

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.length !== 3) throw new Error('Usage: npm run verify -- journal.jsonl input.csv output.csv');
  const [journal, input, output] = await Promise.all(args.map((path) => readFile(path)));
  const result = await verify(journal.toString('utf8'), input, output);
  process.stdout.write(`Verified ${result.events} events; output SHA-256 ${result.output_hash}\nConsistency only; not proof of authenticity.\n`);
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}

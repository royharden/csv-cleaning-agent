/** Optional external data only. Never called by app/eval/CI; no default URL or network at import. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_BYTES = 5_000_000;
const TIMEOUT_MS = 30_000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Owner must verify official repository provenance, file revision and terms before opting in. */
export async function downloadRaha(args: readonly string[]): Promise<string> {
  if (args.length !== 4 || args[0] !== '--download' || args[1] !== '--terms-reviewed' || args[2] !== '--url') {
    throw new Error('Off by default. After owner provenance/terms review: tsx scripts/raha-download.ts --download --terms-reviewed --url <official raw CSV URL>.');
  }
  const url = new URL(args[3]);
  if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || url.port || url.username || url.password || url.search || url.hash ||
    !/^\/BigDaMa\/raha\/[A-Za-z0-9._-]+\/datasets\/[A-Za-z0-9._/-]+\.csv$/.test(url.pathname) ||
    url.pathname.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('Use an owner-verified HTTPS raw.githubusercontent.com/BigDaMa/raha/<revision>/datasets/...csv URL; no redirects or arbitrary hosts.');
  }
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), TIMEOUT_MS);
  let bytes: Uint8Array;
  try {
    const response = await fetch(url, { signal: deadline.signal, redirect: 'error', credentials: 'omit' });
    if (!response.ok || response.body === null) throw new Error(`Download failed (${response.status}); no file written.`);
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) throw new Error('External download exceeds byte limit or has invalid length.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('External download exceeds 5,000,000 bytes; no file written.'); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  } finally { clearTimeout(timer); }
  const directory = join(root, 'data', 'external', 'raha');
  await mkdir(directory, { recursive: true });
  const output = join(directory, `${crypto.randomUUID()}.csv`);
  // Random basename + exclusive creation; only a completed bounded download is written, never unpacked.
  await writeFile(output, bytes, { flag: 'wx' });
  return output;
}

const invoked = process.argv[1];
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  downloadRaha(process.argv.slice(2)).then((path) => { console.log(`Optional external CSV saved locally: ${path}. Not part of seeded eval; do not commit.`); })
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}

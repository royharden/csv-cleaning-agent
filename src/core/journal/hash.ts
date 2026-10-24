/**
 * SHA-256 hashing (C §2.4, PLAN.md M1 AC5). One encoder, one digest: WebCrypto `crypto.subtle.digest('SHA-256')`
 * via `globalThis.crypto`, available in browsers (secure contexts, incl. localhost), Node >= 18 and Deno.
 * Output: lowercase hex, 64 characters.
 */

import type { Table } from '../table.ts';
import { canonicalJsonBytes, canonicalTableBytes } from './canonical.ts';

export type Sha256Hex = string;

function subtle(): SubtleCrypto {
  const api = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (api === undefined) {
    throw new Error('WebCrypto SubtleCrypto is unavailable (browsers need a secure context; Node needs >= 18).');
  }
  return api;
}

function toHex(buffer: ArrayBuffer): Sha256Hex {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/** SHA-256 of raw bytes. The input is copied into a fresh ArrayBuffer-backed view before digesting. */
export async function sha256Hex(bytes: Uint8Array): Promise<Sha256Hex> {
  const copy = new Uint8Array(bytes);
  return toHex(await subtle().digest('SHA-256', copy));
}

/** SHA-256 of the UTF-8 encoding of a string. */
export async function sha256Text(text: string): Promise<Sha256Hex> {
  return sha256Hex(new TextEncoder().encode(text));
}

/** Table hash = SHA-256 of canonical table serialisation v1. */
export async function hashTable(table: Table): Promise<Sha256Hex> {
  return sha256Hex(canonicalTableBytes(table));
}

/** Hash of a JSON-compatible value via canonical JSON (params_hash, event_hash in M3). */
export async function hashCanonicalJson(value: unknown): Promise<Sha256Hex> {
  return sha256Hex(canonicalJsonBytes(value));
}

export function isSha256Hex(value: unknown): value is Sha256Hex {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

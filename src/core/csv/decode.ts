/**
 * Byte decoding (spec item 1, C §1 item 1, PLAN.md M1 AC2). Pure; browser- and Node-safe (WHATWG TextDecoder).
 *
 * Order: byte cap (before any decode) -> empty check -> UTF-16 BOM rejection -> UTF-8 BOM detection ->
 * strict UTF-8 (`fatal: true`) -> windows-1252 fallback with a visible warning.
 */

import { MAX_INPUT_BYTES, UTF8_BOM_BYTES, type Encoding } from '../constants.ts';

export type InputErrorCode = 'cap_bytes' | 'cap_records' | 'cap_columns' | 'empty_file' | 'unsupported_encoding';

/** A rejection of the input file. Cap errors name the cap and its limit. */
export interface InputError {
  readonly code: InputErrorCode;
  readonly message: string;
  readonly cap?: { readonly name: string; readonly limit: number };
}

export type InputWarningCode =
  | 'windows1252_fallback'
  | 'bom_with_invalid_utf8'
  | 'mixed_terminators'
  | 'malformed_quotes'
  | 'record_count_mismatch'
  | 'delimiter_defaulted';

/** Non-fatal findings shown in the validation report. */
export interface InputWarning {
  readonly code: InputWarningCode;
  readonly message: string;
}

export interface Decoded {
  /** Decoded text without the UTF-8 BOM. */
  readonly text: string;
  readonly encoding: Encoding;
  /** The input started with the UTF-8 BOM EF BB BF. */
  readonly bom: boolean;
  readonly byteLength: number;
  readonly warnings: readonly InputWarning[];
}

export type DecodeResult = { readonly ok: true; readonly value: Decoded } | { readonly ok: false; readonly error: InputError };

/** Locale-fixed thousands grouping for messages ("5,000,000"). */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function hasUtf8Bom(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 && bytes[0] === UTF8_BOM_BYTES[0] && bytes[1] === UTF8_BOM_BYTES[1] && bytes[2] === UTF8_BOM_BYTES[2]
  );
}

function hasUtf16Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff));
}

function toBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
}

function fail(error: InputError): DecodeResult {
  return { ok: false, error };
}

/** Decode the raw file bytes. Never throws for bad input; returns `{ok:false}` with a named reason. */
export function decode(input: Uint8Array | ArrayBuffer): DecodeResult {
  const bytes = toBytes(input);

  if (bytes.byteLength > MAX_INPUT_BYTES) {
    return fail({
      code: 'cap_bytes',
      message: `File is ${formatCount(bytes.byteLength)} bytes; the limit is ${formatCount(MAX_INPUT_BYTES)} bytes.`,
      cap: { name: 'MAX_INPUT_BYTES', limit: MAX_INPUT_BYTES },
    });
  }
  if (bytes.byteLength === 0) {
    return fail({ code: 'empty_file', message: 'File is empty (0 bytes).' });
  }
  if (hasUtf16Bom(bytes)) {
    return fail({
      code: 'unsupported_encoding',
      message: 'File starts with a UTF-16 byte order mark; only UTF-8 and windows-1252 are supported. Re-save it as UTF-8.',
    });
  }

  const bom = hasUtf8Bom(bytes);
  const body = bom ? bytes.subarray(UTF8_BOM_BYTES.length) : bytes;
  const warnings: InputWarning[] = [];
  let text: string;
  let encoding: Encoding;

  try {
    // ignoreBOM: true keeps any FURTHER U+FEFF as content; the leading BOM was already removed above.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
    encoding = 'utf-8';
  } catch {
    text = new TextDecoder('windows-1252').decode(body);
    encoding = 'windows-1252';
    warnings.push({
      code: 'windows1252_fallback',
      message: 'File is not valid UTF-8; it was decoded as windows-1252. Check accented characters. Export will be UTF-8.',
    });
    if (bom) {
      warnings.push({
        code: 'bom_with_invalid_utf8',
        message: 'File starts with a UTF-8 byte order mark but is not valid UTF-8.',
      });
    }
  }

  if (text.length === 0) {
    return fail({ code: 'empty_file', message: 'File contains no data after the byte order mark.' });
  }

  return { ok: true, value: { text, encoding, bom, byteLength: bytes.byteLength, warnings } };
}

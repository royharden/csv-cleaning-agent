#!/usr/bin/env node
// Static syntax check for erasable TypeScript (PLAN.md §2 row 18, §8 item 4).
//
// Usage:  node --no-warnings scripts/check-syntax.mjs [files...]
//   With file arguments: checks exactly those files (paths relative to the current directory).
//   Without arguments:   walks src/, scripts/, tests/ and supabase/ under the repo root (skipping
//                        node_modules, dist, .git) and checks every .ts / .mts / .cts file.
//
// Each file is passed to node:module stripTypeScriptTypes in "strip" mode, which parses it and fails on
// ERR_INVALID_TYPESCRIPT_SYNTAX (parse errors) and ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX (non-erasable
// syntax: enum, namespace, parameter properties, import =). Limits: parse only (no type checking, no
// import resolution); .tsx is not supported by the API and is listed as "inspection only"; the API is
// experimental (run with --no-warnings). `node --check` is NOT used for .ts: it passes ES-module .ts
// files vacuously. This file itself is plain JavaScript, checked with `node --check`.
// Sets process.exitCode = 1 on any failure.

import * as nodeModule from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ROOTS = ['src', 'scripts', 'tests', 'supabase'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage']);
const TS_EXTENSIONS = new Set(['.ts', '.mts', '.cts']);
const INSPECTION_ONLY_EXTENSIONS = new Set(['.tsx']);

const strip = nodeModule.stripTypeScriptTypes;
if (typeof strip !== 'function') {
  console.error(
    'check-syntax: node:module stripTypeScriptTypes is unavailable in Node ' +
      process.version +
      ' (needs Node >= 22.13 or >= 23.2).',
  );
  process.exit(2);
}

function byName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort(byName);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

function collectFiles(args) {
  if (args.length > 0) return args.map((arg) => resolve(process.cwd(), arg));
  const files = [];
  for (const root of DEFAULT_ROOTS) {
    const dir = join(repoRoot, root);
    if (existsSync(dir)) walk(dir, files);
  }
  return files;
}

function display(file) {
  const rel = relative(process.cwd(), file);
  return (rel === '' ? file : rel).split('\\').join('/');
}

const args = process.argv.slice(2);
const explicit = args.length > 0;
const files = collectFiles(args);

let checked = 0;
const failures = [];
const inspectionOnly = [];
const skipped = [];

for (const file of files) {
  const name = display(file);
  const ext = extname(file).toLowerCase();
  if (INSPECTION_ONLY_EXTENSIONS.has(ext)) {
    inspectionOnly.push(name);
    continue;
  }
  if (!TS_EXTENSIONS.has(ext)) {
    if (explicit) skipped.push(name);
    continue;
  }
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch (error) {
    failures.push({ file: name, code: 'READ_FAILED', message: String(error && error.message ? error.message : error) });
    continue;
  }
  checked += 1;
  try {
    strip(source, { mode: 'strip', sourceUrl: name });
  } catch (error) {
    const code = error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
    const message = error && typeof error.message === 'string' ? error.message : String(error);
    failures.push({ file: name, code, message });
  }
}

for (const failure of failures) {
  console.error(`FAIL ${failure.file} [${failure.code}]`);
  for (const line of failure.message.split(/\r?\n/)) console.error(`    ${line}`);
}
if (skipped.length > 0) {
  console.log(`skipped (not .ts): ${skipped.join(', ')}`);
}
if (inspectionOnly.length > 0) {
  console.log(`inspection only (.tsx is not parsed by this check): ${inspectionOnly.join(', ')}`);
}
console.log(`check-syntax: ${checked} TypeScript file(s) checked, ${failures.length} failed.`);

if (failures.length > 0) process.exitCode = 1;

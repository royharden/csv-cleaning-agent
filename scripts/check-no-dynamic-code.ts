/**
 * Static check: no dynamic code in the transform kit (C §5.1 "Static"; PLAN.md M2 AC9, AC2). Run with
 * `npm run check:static` (tsx). Plain text scan; exits 1 with file:line for every finding.
 *
 * Rules:
 *  1. Every .ts file under src/core/transformkit: no `eval(`, no `new Function`, and no `RegExp(` call whose
 *     first argument is not a string literal (a regex built from data, params or model output). Literal regex
 *     syntax (/.../) is allowed: it cannot be built from input.
 *  2. src/core/transformkit/grammar/number.ts and ops/parse_number.ts: no `Number(`, `parseFloat`, `parseInt`
 *     (number parsing is string operations only, so nothing is rounded).
 * Comments are scanned too, so keep these tokens out of comments in the checked files. This conservative
 * source scanner is not a JavaScript security analyser: aliases/computed properties are outside its scope.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kitRoot = join(repoRoot, 'src', 'core', 'transformkit');
const NUMBER_FILES = new Set(['grammar/number.ts', 'ops/parse_number.ts']);

interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
}

const DYNAMIC_RULES: readonly Rule[] = [
  { name: 'eval(', pattern: /\beval\s*\(/g },
  { name: 'new Function', pattern: /\bnew\s+Function\b/g },
];

const NUMBER_RULES: readonly Rule[] = [
  { name: 'Number(', pattern: /\bNumber\s*\(/g },
  { name: 'parseFloat', pattern: /\bparseFloat\b/g },
  { name: 'parseInt', pattern: /\bparseInt\b/g },
];

export interface Finding {
  readonly line: number;
  readonly rule: string;
}

/** Accept one complete, non-interpolated literal argument, followed by a comma or closing parenthesis. */
function literalArgument(source: string, start: number): boolean {
  let pos = start;
  while (/\s/.test(source[pos] ?? '') && pos < source.length) pos += 1;
  const quote = source[pos];
  if (quote !== "'" && quote !== '"' && quote !== '`') return false;
  pos += 1;
  while (pos < source.length) {
    const ch = source[pos];
    if (ch === '\\') {
      pos += 2;
      continue;
    }
    if (quote === '`' && ch === '$' && source[pos + 1] === '{') return false;
    if (quote !== '`' && (ch === '\n' || ch === '\r')) return false;
    if (ch === quote) {
      pos += 1;
      while (pos < source.length && /\s/.test(source[pos])) pos += 1;
      return source[pos] === ',' || source[pos] === ')';
    }
    pos += 1;
  }
  return false;
}

/** Full-source scan (including newlines), exported so regression test source need not execute the CLI. */
export function scanSource(source: string, numberGrammar = false): Finding[] {
  const findings: Finding[] = [];
  const at = (offset: number, rule: string) => {
    findings.push({ line: source.slice(0, offset).split(/\r\n|\r|\n/).length, rule });
  };
  for (const rule of numberGrammar ? [...DYNAMIC_RULES, ...NUMBER_RULES] : DYNAMIC_RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of source.matchAll(rule.pattern)) at(match.index, rule.name);
  }
  for (const match of source.matchAll(/\bRegExp\s*\(/g)) {
    if (!literalArgument(source, match.index + match[0].length)) at(match.index, 'non-literal RegExp(');
  }
  return findings.sort((a, b) => a.line - b.line || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
}

function listTs(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listTs(full, out);
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
}

export function main(): void {
  const files: string[] = [];
  listTs(kitRoot, files);
  const findings: string[] = [];
  for (const file of files) {
    const rel = relative(kitRoot, file).split('\\').join('/');
    const source = readFileSync(file, 'utf8');
    for (const finding of scanSource(source, NUMBER_FILES.has(rel))) {
      findings.push(`src/core/transformkit/${rel}:${finding.line}: ${finding.rule}`);
    }
  }
  for (const finding of findings) console.error(finding);
  console.log(`check-no-dynamic-code: ${files.length} file(s) scanned, ${findings.length} finding(s).`);
  if (findings.length > 0) process.exitCode = 1;
}

// Importing scanSource for tests never starts the CLI or scans the filesystem.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

/** Static-checker regression source; written in Dirty Mode, never executed. */
import { describe, expect, it } from 'vitest';
import { scanSource } from '../../scripts/check-no-dynamic-code.ts';

describe('dynamic-code source scanner', () => {
  it('detects multiline eval and Function construction and reports the starting line', () => {
    expect(scanSource('const x = 1;\neval\n(value);\nnew\nFunction(code);')).toEqual([
      { line: 2, rule: 'eval(' },
      { line: 4, rule: 'new Function' },
    ]);
  });

  it('accepts complete string literals with whitespace and optional flags', () => {
    expect(scanSource("RegExp( 'a', 'i'); new RegExp(\n\"b\\\\d\"\n); RegExp(`fixed`);")).toEqual([]);
  });

  it('rejects data, interpolation, concatenation and multiline non-literal arguments', () => {
    for (const source of ['RegExp(value)', 'RegExp(`a${value}`)', "RegExp('a' + value)", 'RegExp(\n value\n)']) {
      expect(scanSource(source), source).toEqual([{ line: 1, rule: 'non-literal RegExp(' }]);
    }
  });

  it('enforces string-only number parsing only in the two designated modules', () => {
    const source = 'Number(\nvalue); parseFloat(value); parseInt(value, 10);';
    expect(scanSource(source)).toEqual([]);
    expect(scanSource(source, true).map((f) => f.rule)).toEqual(['Number(', 'parseFloat', 'parseInt']);
  });
});

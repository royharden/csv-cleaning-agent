/**
 * Number and date grammars: the S grammar traps (PLAN.md M2 AC2, AC3, AC10; C §5.1 "Grammars").
 * Written in Dirty Mode; not executed yet.
 */

import { describe, expect, it } from 'vitest';
import { DATE_FORMATS, type DateFormat } from '../../src/core/constants.ts';
import {
  hasTwoDigitYear,
  isLeapYear,
  parseDateCell,
  swapDayMonth,
  tokenizeDateFormat,
} from '../../src/core/transformkit/grammar/date.ts';
import { parseNumberCell, type NumberGrammar } from '../../src/core/transformkit/grammar/number.ts';

const US: NumberGrammar = { decimal: '.', thousands: ',', currency: ['$', 'USD'], parens_negative: true };
const EU: NumberGrammar = { decimal: ',', thousands: '.', currency: ['€', 'EUR'], parens_negative: false };

function canon(value: string, grammar: NumberGrammar): string | null {
  const parsed = parseNumberCell(value, grammar);
  return parsed.ok ? parsed.canonical : null;
}

describe('number grammar (string operations only)', () => {
  it('long-digits: a 20-digit amount is preserved exactly (no rounding)', () => {
    expect(canon('12345678901234567890', US)).toBe('12345678901234567890');
    expect(canon('$12,345,678,901,234,567,890.12', US)).toBe('12345678901234567890.12');
    expect(canon('0.10000000000000000001', US)).toBe('0.10000000000000000001');
  });

  it('decimal point vs decimal comma', () => {
    expect(canon('1,234.50', US)).toBe('1234.50');
    expect(canon('1.234,50', EU)).toBe('1234.50');
    expect(canon('1.234,50', US)).toBeNull();
  });

  it('currency prefix and suffix, with optional space', () => {
    expect(canon('$1,204.50', US)).toBe('1204.50');
    expect(canon('USD 99', US)).toBe('99');
    expect(canon('99 USD', US)).toBe('99');
    expect(canon('1.204,50 €', EU)).toBe('1204.50');
    expect(canon('€1.204,50', EU)).toBe('1204.50');
    expect(canon('£5', US)).toBeNull(); // marker not in the step's list
    expect(canon('$5 USD', US)).toBeNull(); // two markers
  });

  it('parens negative (only when enabled) and minus signs', () => {
    expect(canon('(1,234.00)', US)).toBe('-1234.00');
    expect(canon('($5)', US)).toBe('-5');
    expect(canon('(5)', EU)).toBeNull();
    expect(canon('-5', US)).toBe('-5');
    expect(canon('−5', US)).toBe('-5');
    expect(canon('-$5', US)).toBe('-5');
    expect(canon('$-5', US)).toBe('-5');
  });

  it('rejects doubled signs, a sign inside parens, "+", exponent, hex, Infinity and NaN', () => {
    for (const value of ['--5', '-$-5', '(-5)', '+5', '1e5', '1E5', '0x1F', 'Infinity', '-Infinity', 'NaN', '5-']) {
      expect(canon(value, US), value).toBeNull();
    }
  });

  it('percentages are not supported ("12%" stays unparsed)', () => {
    expect(canon('12%', US)).toBeNull();
    expect(canon('12 %', US)).toBeNull();
  });

  it('malformed grouping is rejected; ungrouped digits are allowed', () => {
    expect(canon('1,23,456', US)).toBeNull();
    expect(canon('1234,567', US)).toBeNull();
    expect(canon(',123', US)).toBeNull();
    expect(canon('1234567', US)).toBe('1234567');
    expect(canon('1 234', { ...US, thousands: ' ' })).toBe('1234');
    expect(canon('1,234', { ...US, thousands: 'none' })).toBeNull();
  });

  it('rejects a missing integer part, an empty fraction, two decimal separators and padding', () => {
    for (const value of ['.5', '12.', '1.2.3', ' 12', '12 ', '', '$']) {
      expect(canon(value, US), JSON.stringify(value)).toBeNull();
    }
  });

  it('"1,234" parses under the stated grammar (ambiguity is the guard\'s job, not the grammar\'s)', () => {
    expect(canon('1,234', US)).toBe('1234');
    expect(canon('1,234', { decimal: ',', thousands: '.', currency: [], parens_negative: false })).toBe('1.234');
  });

  it('strips integer leading zeros in the canonical form but keeps the fraction as written', () => {
    expect(canon('007', US)).toBe('7');
    expect(canon('000', US)).toBe('0');
    expect(canon('00.50', US)).toBe('0.50');
    const parsed = parseNumberCell('007', US);
    expect(parsed.ok && parsed.integer_text).toBe('007');
  });
});

describe('date grammar (tokenised stated format, Gregorian, POSIX pivot 69)', () => {
  it('tokenises every whitelist format into YYYY/YY/MM/DD and separators', () => {
    for (const format of DATE_FORMATS) {
      const tokens = tokenizeDateFormat(format);
      expect(tokens.filter((t) => t.kind !== 'sep')).toHaveLength(3);
    }
    expect(tokenizeDateFormat('YYYYMMDD').map((t) => t.kind)).toEqual(['year4', 'month', 'day']);
  });

  it('parses each format to YYYY-MM-DD', () => {
    const cases: [DateFormat, string][] = [
      ['YYYY-MM-DD', '2023-04-05'],
      ['YYYY/MM/DD', '2023/04/05'],
      ['YYYY.MM.DD', '2023.04.05'],
      ['YYYYMMDD', '20230405'],
      ['DD/MM/YYYY', '05/04/2023'],
      ['MM/DD/YYYY', '04/05/2023'],
      ['DD-MM-YYYY', '05-04-2023'],
      ['MM-DD-YYYY', '04-05-2023'],
      ['DD.MM.YYYY', '05.04.2023'],
      ['MM.DD.YYYY', '04.05.2023'],
      ['DD/MM/YY', '05/04/23'],
      ['MM/DD/YY', '04/05/23'],
    ];
    for (const [format, value] of cases) {
      const parsed = parseDateCell(value, format);
      expect(parsed.ok && parsed.iso, `${format} ${value}`).toBe('2023-04-05');
    }
  });

  it('accepts 1-2 digit day/month in separated formats only', () => {
    expect(parseDateCell('5/4/2023', 'DD/MM/YYYY').ok).toBe(true);
    expect(parseDateCell('005/04/2023', 'DD/MM/YYYY').ok).toBe(false);
    expect(parseDateCell('2023045', 'YYYYMMDD').ok).toBe(false);
    expect(parseDateCell('23-04-05', 'YYYY-MM-DD').ok).toBe(false);
  });

  it('impossible-date: 31/02/2023 is unparsed; leap years are Gregorian', () => {
    expect(parseDateCell('31/02/2023', 'DD/MM/YYYY').ok).toBe(false);
    expect(parseDateCell('29/02/2024', 'DD/MM/YYYY').ok).toBe(true);
    expect(parseDateCell('29/02/2023', 'DD/MM/YYYY').ok).toBe(false);
    expect(parseDateCell('29/02/1900', 'DD/MM/YYYY').ok).toBe(false);
    expect(parseDateCell('29/02/2000', 'DD/MM/YYYY').ok).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(parseDateCell('2023-13-01', 'YYYY-MM-DD').ok).toBe(false);
    expect(parseDateCell('2023-00-10', 'YYYY-MM-DD').ok).toBe(false);
    expect(parseDateCell('0000-01-01', 'YYYY-MM-DD').ok).toBe(false);
  });

  it('two-digit-year: POSIX pivot 69', () => {
    const at = (value: string) => {
      const parsed = parseDateCell(value, 'MM/DD/YY');
      return parsed.ok ? parsed.iso : null;
    };
    expect(at('01/02/69')).toBe('1969-01-02');
    expect(at('01/02/99')).toBe('1999-01-02');
    expect(at('01/02/00')).toBe('2000-01-02');
    expect(at('01/02/68')).toBe('2068-01-02');
    expect(hasTwoDigitYear('MM/DD/YY')).toBe(true);
    expect(hasTwoDigitYear('YYYY-MM-DD')).toBe(false);
  });

  it('no per-cell guessing: a cell in another format is unparsed under the stated one', () => {
    expect(parseDateCell('2023-04-05', 'DD/MM/YYYY').ok).toBe(false);
    expect(parseDateCell('05.04.2023', 'DD/MM/YYYY').ok).toBe(false);
    expect(parseDateCell('5 Apr 2023', 'DD/MM/YYYY').ok).toBe(false);
    expect(parseDateCell(' 05/04/2023', 'DD/MM/YYYY').ok).toBe(false);
  });

  it('ambiguous-dates and contradictory-dates are told apart by the day/month twin', () => {
    expect(swapDayMonth('DD/MM/YYYY')).toBe('MM/DD/YYYY');
    expect(swapDayMonth('MM.DD.YYYY')).toBe('DD.MM.YYYY');
    expect(swapDayMonth('DD/MM/YY')).toBe('MM/DD/YY');
    expect(swapDayMonth('YYYY-MM-DD')).toBeNull();
    expect(swapDayMonth('YYYYMMDD')).toBeNull();
    // ambiguous: valid both ways
    expect(parseDateCell('03/04/2023', 'DD/MM/YYYY').ok && parseDateCell('03/04/2023', 'MM/DD/YYYY').ok).toBe(true);
    // proves DD/MM only
    expect(parseDateCell('25/04/2023', 'DD/MM/YYYY').ok).toBe(true);
    expect(parseDateCell('25/04/2023', 'MM/DD/YYYY').ok).toBe(false);
  });
});

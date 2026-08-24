import { describe, expect, test } from 'vitest';
import {
  MAX_GROWTH_PERCENT,
  paiseToRupeeInput,
  parseAbsolutePaise,
  parseSignedBasisPoints,
  parseSignedPaise,
  parseSignedPaiseFromInput,
} from './signedAmounts.js';

describe('parseAbsolutePaise', () => {
  test('scales rupees to paise exactly', () => {
    expect(parseAbsolutePaise('0')).toEqual({ ok: true, value: '0' });
    expect(parseAbsolutePaise('1')).toEqual({ ok: true, value: '100' });
    expect(parseAbsolutePaise('1250000.50')).toEqual({ ok: true, value: '125000050' });
    expect(parseAbsolutePaise('.5')).toEqual({ ok: true, value: '50' });
    expect(parseAbsolutePaise(' 42.07 ')).toEqual({ ok: true, value: '4207' });
  });

  test('carries figures far past Number.MAX_SAFE_INTEGER without rounding', () => {
    const rupees = '99999999999999999.99';
    expect(parseAbsolutePaise(rupees)).toEqual({ ok: true, value: '9999999999999999999' });
    expect(String(Math.round(Number(rupees) * 100))).toBe('10000000000000000000');
  });

  test('refuses sub-paise precision instead of silently rounding it away', () => {
    const result = parseAbsolutePaise('100.005');
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/two decimal places/u);
  });

  test('refuses empty, non-numeric and negative input', () => {
    for (const input of ['', '   ', null, undefined, 'abc', '1,000', '1.2.3']) {
      expect(parseAbsolutePaise(input).ok, String(input)).toBe(false);
    }
    expect(parseAbsolutePaise('-1').problem).toMatch(/cannot be negative/u);
  });

  test('accepts exponent notation, which type=number inputs can produce', () => {
    expect(parseAbsolutePaise('1e3')).toEqual({ ok: true, value: '100000' });
    expect(parseAbsolutePaise('1.5e2')).toEqual({ ok: true, value: '15000' });
  });
});

describe('parseSignedPaise', () => {
  test('the direction supplies the sign, never the typed magnitude', () => {
    expect(parseSignedPaise('increase', '500')).toEqual({ ok: true, value: '50000' });
    expect(parseSignedPaise('decrease', '500')).toEqual({ ok: true, value: '-50000' });
  });

  test('zero is not a growth command', () => {
    expect(parseSignedPaise('increase', '0').problem).toMatch(/above zero/u);
    expect(parseSignedPaise('increase', '0.00').problem).toMatch(/above zero/u);
  });
});

describe('parseSignedBasisPoints', () => {
  test('percent becomes basis points at the same scale the backend uses', () => {
    expect(parseSignedBasisPoints('increase', '2.5')).toEqual({ ok: true, value: 250 });
    expect(parseSignedBasisPoints('decrease', '1.5')).toEqual({ ok: true, value: -150 });
    expect(parseSignedBasisPoints('increase', '0.01')).toEqual({ ok: true, value: 1 });
  });

  test('the business maximum is enforced before the request is built', () => {
    expect(parseSignedBasisPoints('increase', String(MAX_GROWTH_PERCENT))).toEqual({
      ok: true,
      value: MAX_GROWTH_PERCENT * 100,
    });
    expect(parseSignedBasisPoints('increase', String(MAX_GROWTH_PERCENT + 1)).ok).toBe(false);
  });

  test('a rate finer than one basis point is refused, not rounded to zero', () => {
    const result = parseSignedBasisPoints('increase', '0.001');
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/two decimal places/u);
  });
});

describe('parseSignedPaiseFromInput', () => {
  test('the typed sign is preserved for the per-fund delta grid', () => {
    expect(parseSignedPaiseFromInput('250000')).toEqual({ ok: true, value: '25000000' });
    expect(parseSignedPaiseFromInput('-100000')).toEqual({ ok: true, value: '-10000000' });
  });

  test('zero is refused', () => {
    expect(parseSignedPaiseFromInput('0').ok).toBe(false);
    expect(parseSignedPaiseFromInput('-0').ok).toBe(false);
  });
});

describe('paiseToRupeeInput', () => {
  test('round-trips a stored figure without moving it', () => {
    for (const paise of ['0', '1', '99', '100', '125000050', '9999999999999999999']) {
      expect(parseAbsolutePaise(paiseToRupeeInput(paise))).toEqual({ ok: true, value: paise });
    }
  });

  test('renders the shortest exact decimal', () => {
    expect(paiseToRupeeInput('0')).toBe('0');
    expect(paiseToRupeeInput('5')).toBe('0.05');
    expect(paiseToRupeeInput('50')).toBe('0.5');
    expect(paiseToRupeeInput('100')).toBe('1');
    expect(paiseToRupeeInput('125000050')).toBe('1250000.5');
  });

  test('a 19-digit figure survives, where Number would not', () => {
    expect(paiseToRupeeInput('9999999999999999999')).toBe('99999999999999999.99');
    expect(String(Number('9999999999999999999') / 100)).not.toBe('99999999999999999.99');
  });

  test('non-integer input yields empty text rather than NaN', () => {
    for (const input of [null, undefined, '', 'abc', '1.5']) {
      expect(paiseToRupeeInput(input), String(input)).toBe('');
    }
  });
});

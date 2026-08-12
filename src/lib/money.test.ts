import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatSigned, parseMoney, toAmountInput } from './money.js';

describe('parseMoney', () => {
  it('reads both decimal conventions', () => {
    expect(parseMoney('12.50')).toBe(1250);
    expect(parseMoney('12,50')).toBe(1250);
  });

  it('reads grouped thousands either way round', () => {
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('1,234.56')).toBe(123456);
  });

  it('treats three trailing digits as grouping, not decimals', () => {
    // The genuinely ambiguous case. "1.234" is a thousand-something.
    expect(parseMoney('1.234')).toBe(123400);
    expect(parseMoney('1,234')).toBe(123400);
  });

  it('pads a single decimal digit', () => {
    expect(parseMoney('12,5')).toBe(1250);
    expect(parseMoney('.5')).toBe(50);
  });

  it('reads whole amounts', () => {
    expect(parseMoney('12')).toBe(1200);
    expect(parseMoney('0')).toBe(0);
  });

  it('ignores currency symbols and spaces', () => {
    expect(parseMoney(' € 12,50 ')).toBe(1250);
    expect(parseMoney('$12.50')).toBe(1250);
    expect(parseMoney('12.50 EUR')).toBe(1250);
  });

  it('reads exactly three trailing digits as grouping', () => {
    expect(parseMoney('12.509')).toBe(1250900);
  });

  it('reads four or more trailing digits as decimals, dropping the excess', () => {
    // Too many digits to be a grouping mark, so it must be a decimal point.
    expect(parseMoney('12.5099')).toBe(1250);
  });

  it('tolerates a trailing separator mid-typing', () => {
    expect(parseMoney('12.')).toBe(1200);
    expect(parseMoney('12,')).toBe(1200);
  });

  it('handles negatives', () => {
    expect(parseMoney('-12.50')).toBe(-1250);
  });

  it('returns null for anything it cannot read', () => {
    for (const input of ['', '   ', '-', 'abc', '€', ',', '.']) {
      expect(parseMoney(input), JSON.stringify(input)).toBeNull();
    }
  });

  it('round-trips whatever it formats', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), (cents) => {
        expect(parseMoney(toAmountInput(cents))).toBe(cents);
      }),
    );
  });
});

describe('toAmountInput', () => {
  it('always shows two decimal places', () => {
    expect(toAmountInput(1250)).toBe('12.50');
    expect(toAmountInput(5)).toBe('0.05');
    expect(toAmountInput(0)).toBe('0.00');
    expect(toAmountInput(100)).toBe('1.00');
  });

  it('keeps the sign outside the digits', () => {
    expect(toAmountInput(-1250)).toBe('-12.50');
    expect(toAmountInput(-5)).toBe('-0.05');
  });
});

describe('formatSigned', () => {
  it('marks direction explicitly, and leaves zero unmarked', () => {
    expect(formatSigned(1250, 'EUR')).toMatch(/^\+/);
    expect(formatSigned(-1250, 'EUR')).toMatch(/^−/);
    expect(formatSigned(0, 'EUR')).not.toMatch(/^[+−]/);
  });

  it('survives a currency code it does not recognise', () => {
    expect(formatSigned(1250, 'XYZ')).toContain('12.50');
  });
});

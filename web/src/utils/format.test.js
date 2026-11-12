import { describe, expect, it } from 'vitest';
import { barWidthPercent, formatQuantity, maxQuantity, dateRangeToInstants } from '../../../../inventory-ui/src/utils/format';

describe('formatQuantity', () => {
  it('formats values above 2^53 exactly', () => {
    expect(formatQuantity('9007199254740993')).toBe('9,007,199,254,740,993');
  });

  it('formats aggregates above Long.MAX_VALUE exactly', () => {
    expect(formatQuantity('18446744073709551614')).toBe('18,446,744,073,709,551,614');
  });

  it('formats zero and missing values', () => {
    expect(formatQuantity('0')).toBe('0');
    expect(formatQuantity(null)).toBe('—');
  });
});

describe('barWidthPercent', () => {
  it('returns 0 when every quantity is zero (no division)', () => {
    expect(barWidthPercent('0', '0')).toBe(0);
  });

  it('computes ratios with 0.1% resolution', () => {
    expect(barWidthPercent('5', '10')).toBe(50);
    expect(barWidthPercent('1', '3')).toBe(33.3);
  });

  it('is exact for values above 2^53', () => {
    expect(barWidthPercent('18446744073709551614', '18446744073709551614')).toBe(100);
  });
});

describe('maxQuantity', () => {
  it('compares with BigInt, not Number', () => {
    expect(maxQuantity(['9007199254740993', '9007199254740992', '5'])).toBe('9007199254740993');
  });

  it('is "0" for an empty list', () => {
    expect(maxQuantity([])).toBe('0');
  });
});

describe('dateRangeToInstants', () => {
  it('makes "to" exclusive by moving it to the start of the next local day', () => {
    const { from, to } = dateRangeToInstants('2026-01-01', '2026-01-31');
    expect(new Date(from).getTime()).toBe(new Date('2026-01-01T00:00:00').getTime());
    expect(new Date(to).getTime()).toBe(new Date('2026-02-01T00:00:00').getTime());
  });

  it('leaves empty dates undefined', () => {
    expect(dateRangeToInstants('', '')).toEqual({ from: undefined, to: undefined });
  });
});

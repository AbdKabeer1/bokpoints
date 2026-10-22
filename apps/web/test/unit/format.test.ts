import { describe, expect, it } from 'vitest';
import { formatDate, isEmail, normalizeScan, parseAmountToCents } from '../../src/format';

describe('parseAmountToCents', () => {
  it('reads both the decimal comma and the decimal dot', () => {
    expect(parseAmountToCents('12,50')).toBe(1250);
    expect(parseAmountToCents('12.50')).toBe(1250);
  });

  it('treats whole euros as euro cents', () => {
    expect(parseAmountToCents('12')).toBe(1200);
    expect(parseAmountToCents('0.5')).toBe(50);
    expect(parseAmountToCents('0,05')).toBe(5);
  });

  it('refuses what a till never types', () => {
    for (const bad of ['', 'abc', '12.345', '-1', '1e3', '  ']) {
      expect(parseAmountToCents(bad)).toBeNull();
    }
  });

  it('refuses amounts beyond the API limit', () => {
    expect(parseAmountToCents('1000000')).toBe(100_000_000);
    expect(parseAmountToCents('1000000.01')).toBeNull();
  });
});

describe('normalizeScan', () => {
  it('strips what a scanner adds around the code', () => {
    expect(normalizeScan('  cust-qr-0001\r\n')).toBe('cust-qr-0001');
    expect(normalizeScan('CUST-QR-0001\t')).toBe('CUST-QR-0001');
    expect(normalizeScan('CUST-QR-0001')).toBe('CUST-QR-0001');
  });

  it('keeps the case, because identifiers are matched exactly', () => {
    expect(normalizeScan('Abc-123')).toBe('Abc-123');
  });

  it('leaves an empty scan empty', () => {
    expect(normalizeScan('')).toBe('');
    expect(normalizeScan(' \r\n\t ')).toBe('');
  });
});

describe('isEmail', () => {
  it('accepts a plausible address and rejects the rest', () => {
    expect(isEmail(' aino@example.fi ')).toBe(true);
    expect(isEmail('aino@example')).toBe(false);
    expect(isEmail('not an email')).toBe(false);
    expect(isEmail('')).toBe(false);
  });
});

describe('formatDate', () => {
  it('shows a UTC date the way a cashier reads it', () => {
    expect(formatDate('2027-01-22')).toBe('22 Jan 2027');
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

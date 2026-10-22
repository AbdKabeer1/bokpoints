import { describe, expect, it } from 'vitest';
import { expiryLabel, formatDate, normalizeCode, typeLabel } from '../../src/lib/format';

describe('formatDate', () => {
  it('shows a UTC date the way a customer reads it', () => {
    expect(formatDate('2027-01-22')).toBe('22 Jan 2027');
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('expiryLabel', () => {
  const now = new Date('2026-10-23T10:00:00Z');

  it('counts whole days until the expiry date', () => {
    expect(expiryLabel('2026-11-04', now)).toBe('in 12 days');
  });

  it('says today and tomorrow instead of in 0 days', () => {
    expect(expiryLabel('2026-10-23', now)).toBe('today');
    expect(expiryLabel('2026-10-24', now)).toBe('tomorrow');
  });

  it('says expired for a date in the past', () => {
    expect(expiryLabel('2026-10-22', now)).toBe('expired');
  });

  it('does not care about the time of day', () => {
    expect(expiryLabel('2026-10-23', new Date('2026-10-23T23:59:00Z'))).toBe('today');
  });
});

describe('typeLabel', () => {
  it('turns ledger types into till words', () => {
    expect(typeLabel('earn')).toBe('Earned');
    expect(typeLabel('expire')).toBe('Expired');
    expect(typeLabel('adjust')).toBe('Adjusted');
    expect(typeLabel('clawback')).toBe('Clawback');
  });

  it('passes an unknown type through rather than hiding it', () => {
    expect(typeLabel('mystery')).toBe('mystery');
  });
});

describe('normalizeCode', () => {
  it('keeps six digits and drops everything else', () => {
    expect(normalizeCode(' 12a34 56 ')).toBe('123456');
    expect(normalizeCode('1234567')).toBe('123456');
    expect(normalizeCode('')).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { expiryDateForEarn } from './expiry.js';

describe('expiryDateForEarn', () => {
  it('expires 2 June points on 2 September (AC-6)', () => {
    expect(expiryDateForEarn(new Date('2026-06-02T10:30:00Z')).toISOString()).toBe(
      '2026-09-02T00:00:00.000Z',
    );
  });

  it('clamps to the last day of a shorter month (31 January -> 30 April)', () => {
    expect(expiryDateForEarn(new Date('2026-01-31T12:00:00Z')).toISOString()).toBe(
      '2026-04-30T00:00:00.000Z',
    );
  });

  it('crosses the year boundary (15 November -> 15 February)', () => {
    expect(expiryDateForEarn(new Date('2026-11-15T00:00:00Z')).toISOString()).toBe(
      '2027-02-15T00:00:00.000Z',
    );
  });

  it('ignores the time of day and returns UTC midnight', () => {
    expect(expiryDateForEarn(new Date('2026-06-02T23:59:59Z')).toISOString()).toBe(
      '2026-09-02T00:00:00.000Z',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { adjustPoints, applyFraudClawback, balanceFromEntries } from './balance.js';

/**
 * Both functions take a signed delta, matching the signed `points` column on
 * a ledger entry: positive adds points, negative removes them.
 */
describe('balanceFromEntries', () => {
  it('sums ledger entries for a customer and store', () => {
    expect(
      balanceFromEntries([
        { type: 'earn', points: 23 },
        { type: 'adjust', points: -5 },
        { type: 'expire', points: -3 },
      ]),
    ).toBe(15);
  });

  it('is zero for an empty ledger', () => {
    expect(balanceFromEntries([])).toBe(0);
  });
});

describe('adjustPoints', () => {
  it('allows adding points', () => {
    expect(adjustPoints(5, 10)).toEqual({ ok: true, balance: 15 });
  });

  it('allows removing points that stay at or above zero', () => {
    expect(adjustPoints(5, -5)).toEqual({ ok: true, balance: 0 });
  });

  it('refuses a removal that would take the balance below zero (AC-11)', () => {
    const r = adjustPoints(5, -8);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BALANCE_WOULD_GO_NEGATIVE');
  });

  it('refuses a zero-point adjustment', () => {
    const r = adjustPoints(5, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_AMOUNT');
  });
});

describe('applyFraudClawback', () => {
  it('may take the balance below zero (AC-11)', () => {
    expect(applyFraudClawback(5, -8)).toEqual({ ok: true, balance: -3 });
  });

  it('refuses a zero-point clawback', () => {
    const r = applyFraudClawback(5, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_AMOUNT');
  });

  it('refuses a clawback that would add points', () => {
    const r = applyFraudClawback(5, 8);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_AMOUNT');
  });
});

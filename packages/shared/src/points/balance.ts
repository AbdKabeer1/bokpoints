import type { LedgerEntry, PointsError, PointsErrorCode } from './types.js';

/**
 * A customer's balance at a store is the sum of that customer's ledger
 * entries for that store, expiry entries included (FRD section 3).
 */
export function balanceFromEntries(entries: LedgerEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.points, 0);
}

const error = (code: PointsErrorCode, message: string): PointsError => ({ code, message });

/**
 * A manual adjustment by an owner or manager.
 *
 * `points` is a signed delta, the same sign convention as the `points` column
 * on a ledger entry: positive adds, negative removes. It may never take the
 * balance below zero (FR-PTS-8, AC-11).
 */
export function adjustPoints(
  balance: number,
  points: number,
): { ok: true; balance: number } | { ok: false; error: PointsError } {
  if (!Number.isInteger(points) || points === 0) {
    return { ok: false, error: error('INVALID_AMOUNT', 'Points must be a non-zero integer') };
  }

  const next = balance + points;
  if (next < 0) {
    return {
      ok: false,
      error: error('BALANCE_WOULD_GO_NEGATIVE', 'An adjustment may not take the balance below zero'),
    };
  }

  return { ok: true, balance: next };
}

/**
 * The only action that may take a balance below zero (FR-PTS-8, FRD 4.6).
 *
 * `points` is a signed delta and must be negative: a clawback only ever
 * removes points.
 */
export function applyFraudClawback(
  balance: number,
  points: number,
): { ok: true; balance: number } | { ok: false; error: PointsError } {
  if (!Number.isInteger(points) || points === 0) {
    return { ok: false, error: error('INVALID_AMOUNT', 'Points must be a non-zero integer') };
  }

  if (points > 0) {
    return {
      ok: false,
      error: error('INVALID_AMOUNT', 'A fraud clawback may only remove points'),
    };
  }

  return { ok: true, balance: balance + points };
}

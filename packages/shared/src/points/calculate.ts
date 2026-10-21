import type { PointsCalculation, PointsRule } from './types.js';

/**
 * points = floor(amountCents * pointsPerEuroThousandths / 100_000)
 *
 * 100_000 = 100 cents per euro * 1000 thousandths per point. Integer maths
 * only, so the server and the offline till cannot disagree on a balance.
 */
const SCALE = 100_000;

export function calculatePoints(amountCents: number, rule: PointsRule): PointsCalculation {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new RangeError('amountCents must be a non-negative integer');
  }

  // FR-PTS-2: below the minimum purchase, award zero and tell the cashier why.
  if (rule.minPurchaseCents !== undefined && amountCents < rule.minPurchaseCents) {
    return { points: 0, uncappedPoints: 0, capped: false, awarded: false, reason: 'below_minimum' };
  }

  const scaled = amountCents * rule.pointsPerEuroThousandths;
  const raw =
    rule.rounding === 'nearest' ? Math.floor((scaled + SCALE / 2) / SCALE) : Math.floor(scaled / SCALE);

  // FR-PTS-3: award the maximum and show that it was capped.
  const capped = rule.maxPointsPerTransaction !== undefined && raw > rule.maxPointsPerTransaction;
  const points = capped ? (rule.maxPointsPerTransaction as number) : raw;

  return { points, uncappedPoints: raw, capped, awarded: true };
}

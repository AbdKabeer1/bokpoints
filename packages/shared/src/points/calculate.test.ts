import { describe, expect, it } from 'vitest';
import { calculatePoints } from './calculate.js';

const onePerEuro = { pointsPerEuroThousandths: 1000 };

describe('calculatePoints', () => {
  it('awards 23 points for 23.80 euros at 1 point per euro', () => {
    // FR-PTS-1 worked example: 1 point per euro, 23.80 euros -> 23 points
    expect(calculatePoints(2380, onePerEuro).points).toBe(23);
  });

  it('rounds down by default', () => {
    expect(calculatePoints(199, onePerEuro).points).toBe(1);
  });

  it('awards zero for a zero amount', () => {
    expect(calculatePoints(0, onePerEuro).points).toBe(0);
  });

  it('refuses an amount below the minimum purchase', () => {
    const r = calculatePoints(999, { ...onePerEuro, minPurchaseCents: 1000 });
    expect(r.awarded).toBe(false);
    expect(r.reason).toBe('below_minimum');
    expect(r.points).toBe(0);
  });

  it('awards points when the amount equals the minimum purchase exactly', () => {
    const r = calculatePoints(1000, { ...onePerEuro, minPurchaseCents: 1000 });
    expect(r.awarded).toBe(true);
    expect(r.points).toBe(10);
  });

  it('caps at the maximum points per transaction', () => {
    const r = calculatePoints(10000, { ...onePerEuro, maxPointsPerTransaction: 50 });
    expect(r.points).toBe(50);
    expect(r.uncappedPoints).toBe(100);
    expect(r.capped).toBe(true);
  });

  it('supports fractional earn rates in thousandths', () => {
    expect(calculatePoints(2380, { pointsPerEuroThousandths: 1500 }).points).toBe(35);
  });

  it('rounds to nearest when the rule asks for it', () => {
    expect(calculatePoints(2380, { ...onePerEuro, rounding: 'nearest' }).points).toBe(24);
  });
});

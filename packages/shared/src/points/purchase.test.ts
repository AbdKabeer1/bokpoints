import { describe, expect, it } from 'vitest';
import { calculatePoints } from './calculate.js';
import { calculatePurchase, type EarningRule } from './purchase.js';

const perEuro = (rate: number, extra: Partial<EarningRule> = {}): EarningRule =>
  ({ type: 'per_euro', version: 1, pointsPerEuroThousandths: rate, ...extra }) as EarningRule;

describe('calculatePurchase (FR-RUL-5, Way Forward WP2)', () => {
  it('behaves exactly like calculatePoints for a store with one per-euro rule', () => {
    for (const amount of [0, 1, 99, 100, 199, 200, 423, 2380, 12345]) {
      const legacy = calculatePoints(amount, {
        pointsPerEuroThousandths: 1000,
        minPurchaseCents: 200,
        maxPointsPerTransaction: 5000,
        rounding: 'floor',
      });
      const result = calculatePurchase({
        lines: [{ amountCents: amount }],
        rules: [perEuro(1000, { minSpendCents: 200 })],
        maxPointsPerSale: 5000,
      });

      expect(result.points, `points at ${amount}`).toBe(legacy.points);
      expect(result.awarded, `awarded at ${amount}`).toBe(legacy.awarded);
      expect(result.capped, `capped at ${amount}`).toBe(legacy.capped);
      expect(result.reason, `reason at ${amount}`).toBe(legacy.reason);
    }
  });

  it('adds the points from every matching rule', () => {
    const result = calculatePurchase({
      lines: [{ amountCents: 2500 }],
      rules: [
        perEuro(1000), // 25
        { type: 'fixed_per_purchase', version: 1, points: 5 },
        { type: 'threshold_bonus', version: 1, points: 10, minSpendCents: 2000 },
      ],
    });

    expect(result.points).toBe(40);
    expect(result.uncappedPoints).toBe(40);
    expect(result.capped).toBe(false);
    expect(result.breakdown.map((entry) => entry.points)).toEqual([25, 5, 10]);
  });

  it('skips a rule whose condition is not met', () => {
    const result = calculatePurchase({
      lines: [{ amountCents: 1500 }],
      rules: [
        perEuro(1000),
        { type: 'threshold_bonus', version: 2, points: 10, minSpendCents: 2000 },
      ],
    });

    expect(result.points).toBe(15);
    expect(result.breakdown[1]).toMatchObject({
      type: 'threshold_bonus',
      applied: false,
      points: 0,
      reason: 'condition_not_met',
    });
  });

  it('caps at the per-sale ceiling and says that it did', () => {
    const result = calculatePurchase({
      lines: [{ amountCents: 5000 }],
      rules: [perEuro(1000), { type: 'fixed_per_purchase', version: 1, points: 50 }],
      maxPointsPerSale: 60,
    });

    expect(result).toMatchObject({
      points: 60,
      uncappedPoints: 100,
      capped: true,
      awarded: true,
    });
  });

  it('reports below_minimum when every rule declined for the minimum spend', () => {
    const result = calculatePurchase({
      lines: [{ amountCents: 100 }],
      rules: [perEuro(1000, { minSpendCents: 200 })],
    });

    expect(result).toMatchObject({ points: 0, awarded: false, reason: 'below_minimum' });
    expect(result.breakdown[0]).toMatchObject({ applied: false, reason: 'below_minimum' });
  });

  it('keeps another rule alive when one rule declines', () => {
    const result = calculatePurchase({
      lines: [{ amountCents: 100 }],
      rules: [perEuro(1000, { minSpendCents: 200 }), { type: 'fixed_per_purchase', version: 1, points: 3 }],
    });

    expect(result).toMatchObject({ points: 3, awarded: true });
    expect(result.reason).toBeUndefined();
  });

  it('treats an empty or zero basket as nothing to award', () => {
    expect(
      calculatePurchase({ lines: [{ amountCents: 0 }], rules: [perEuro(1000)] }),
    ).toMatchObject({ points: 0, awarded: false, reason: 'zero_amount' });

    expect(
      calculatePurchase({ lines: [], rules: [{ type: 'fixed_per_purchase', version: 1, points: 5 }] }),
    ).toMatchObject({ points: 0, awarded: false, reason: 'zero_amount' });
  });

  it('adds a basket of lines before applying the rules', () => {
    const result = calculatePurchase({
      lines: [{ amountCents: 1000 }, { amountCents: 500 }, { amountCents: 250 }],
      rules: [perEuro(1000)],
    });

    expect(result.points).toBe(17); // 1750 cents = 17.5 EUR, rounded down
  });

  it('applies several per-euro rules and the rounding of each', () => {
    const result = calculatePurchase({
      lines: [{ amountCents: 2380 }],
      rules: [
        perEuro(1000),
        { type: 'per_euro', version: 2, pointsPerEuroThousandths: 500, rounding: 'nearest' },
      ],
    });

    expect(result.points).toBe(23 + 12); // 23.8 * 0.5 = 11.9, nearest = 12
  });

  it('refuses nonsense input instead of guessing', () => {
    expect(() =>
      calculatePurchase({ lines: [{ amountCents: -1 }], rules: [perEuro(1000)] }),
    ).toThrow(RangeError);
    expect(() =>
      calculatePurchase({ lines: [{ amountCents: 1.5 }], rules: [perEuro(1000)] }),
    ).toThrow(RangeError);
    expect(() => calculatePurchase({ lines: [{ amountCents: 100 }], rules: [perEuro(0)] })).toThrow(
      RangeError,
    );
    expect(() =>
      calculatePurchase({
        lines: [{ amountCents: 100 }],
        rules: [{ type: 'threshold_bonus', version: 1, points: 5 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculatePurchase({
        lines: [{ amountCents: 100 }],
        rules: [{ type: 'fixed_per_purchase', version: 1, points: 0 }],
      }),
    ).toThrow(RangeError);
  });
});

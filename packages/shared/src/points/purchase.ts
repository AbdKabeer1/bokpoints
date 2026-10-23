import { calculatePoints } from './calculate.js';
import type { PointsRejectionReason, RoundingMode } from './types.js';

/**
 * The points engine evaluates a purchase against a store's set of earning
 * rules (D-116, D-121, Way Forward WP2). The existing per-euro calculation is
 * one rule type among them, so a store with a single per-euro rule gets
 * exactly the same points it always did.
 */

export type EarningRuleType = 'per_euro' | 'fixed_per_purchase' | 'threshold_bonus';

interface EarningRuleBase {
  /** The earning-rule row, when it came from the database. */
  id?: string;
  /** The store's rule version this evaluation used (FR-RUL-4). */
  version: number;
  /** A condition: the basket total must reach this many cents. */
  minSpendCents?: number;
}

export interface PerEuroEarningRule extends EarningRuleBase {
  type: 'per_euro';
  /** Thousandths of a point per euro: 1000 is one point per euro. */
  pointsPerEuroThousandths: number;
  rounding?: RoundingMode;
}

export interface FixedEarningRule extends EarningRuleBase {
  type: 'fixed_per_purchase' | 'threshold_bonus';
  /** Points added once when the rule applies. */
  points: number;
}

export type EarningRule = PerEuroEarningRule | FixedEarningRule;

/** One line of the purchase. The MVP sends one line carrying the total. */
export interface PurchaseLine {
  amountCents: number;
}

export interface RuleBreakdownEntry {
  ruleId?: string;
  type: EarningRuleType;
  version: number;
  points: number;
  applied: boolean;
  reason?: 'below_minimum' | 'condition_not_met';
}

export interface PurchaseCalculation {
  points: number;
  uncappedPoints: number;
  capped: boolean;
  awarded: boolean;
  reason?: PointsRejectionReason;
  /** One entry per rule that was considered, in the order given. */
  breakdown: RuleBreakdownEntry[];
}

export interface PurchaseInput {
  lines: PurchaseLine[];
  rules: EarningRule[];
  /** The store's per-sale ceiling; the platform's technical limit is applied too. */
  maxPointsPerSale?: number;
}

const MAX_RATE_THOUSANDTHS = 1_000_000;
const MAX_RULE_POINTS = 1_000_000;

function assertInteger(value: number, name: string, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} must be an integer of at least ${min}`);
  }
}

function validateRule(rule: EarningRule): void {
  assertInteger(rule.version, 'rule.version', 1);
  if (rule.minSpendCents !== undefined) {
    assertInteger(rule.minSpendCents, 'rule.minSpendCents', 0);
  }

  if (rule.type === 'per_euro') {
    assertInteger(rule.pointsPerEuroThousandths, 'rule.pointsPerEuroThousandths', 1);
    if (rule.pointsPerEuroThousandths > MAX_RATE_THOUSANDTHS) {
      throw new RangeError(`rule.pointsPerEuroThousandths must be at most ${MAX_RATE_THOUSANDTHS}`);
    }
    if (rule.rounding !== undefined && rule.rounding !== 'floor' && rule.rounding !== 'nearest') {
      throw new RangeError('rule.rounding must be floor or nearest');
    }
    return;
  }

  assertInteger(rule.points, 'rule.points', 1);
  if (rule.points > MAX_RULE_POINTS) {
    throw new RangeError(`rule.points must be at most ${MAX_RULE_POINTS}`);
  }
  // A threshold bonus without a threshold would fire on every purchase,
  // which is a fixed rule under another name. Refuse it instead of guessing.
  if (rule.type === 'threshold_bonus' && (rule.minSpendCents ?? 0) <= 0) {
    throw new RangeError('A threshold bonus needs a positive minSpendCents');
  }
}

function evaluate(rule: EarningRule, totalCents: number): RuleBreakdownEntry {
  const base = {
    type: rule.type,
    version: rule.version,
    ...(rule.id === undefined ? {} : { ruleId: rule.id }),
  };

  // A per-euro minimum is the store's old "minimum purchase" (FR-PTS-2), so
  // it keeps that rejection reason; a fixed or threshold condition is a rule
  // condition and says so.
  if (rule.minSpendCents !== undefined && totalCents < rule.minSpendCents) {
    return {
      ...base,
      points: 0,
      applied: false,
      reason: rule.type === 'per_euro' ? 'below_minimum' : 'condition_not_met',
    };
  }

  if (rule.type === 'per_euro') {
    const calculation = calculatePoints(totalCents, {
      pointsPerEuroThousandths: rule.pointsPerEuroThousandths,
      ...(rule.minSpendCents === undefined ? {} : { minPurchaseCents: rule.minSpendCents }),
      ...(rule.rounding === undefined ? {} : { rounding: rule.rounding }),
    });

    if (!calculation.awarded) {
      return {
        ...base,
        points: 0,
        applied: false,
        reason: calculation.reason === 'below_minimum' ? 'below_minimum' : 'condition_not_met',
      };
    }
    return { ...base, points: calculation.points, applied: true };
  }

  return { ...base, points: rule.points, applied: true };
}

export function calculatePurchase(input: PurchaseInput): PurchaseCalculation {
  let totalCents = 0;
  for (const line of input.lines) {
    assertInteger(line.amountCents, 'line.amountCents', 0);
    totalCents += line.amountCents;
  }
  if (!Number.isSafeInteger(totalCents)) {
    throw new RangeError('The basket total is too large');
  }
  if (input.maxPointsPerSale !== undefined) {
    assertInteger(input.maxPointsPerSale, 'maxPointsPerSale', 0);
  }

  // Nothing was bought: no rule fires, and no ledger entry should be written.
  if (totalCents === 0) {
    return {
      points: 0,
      uncappedPoints: 0,
      capped: false,
      awarded: false,
      reason: 'zero_amount',
      breakdown: [],
    };
  }

  const breakdown: RuleBreakdownEntry[] = [];
  let uncappedPoints = 0;
  let anyApplied = false;
  let anyBelowMinimum = false;

  for (const rule of input.rules) {
    validateRule(rule);
    const entry = evaluate(rule, totalCents);
    breakdown.push(entry);
    uncappedPoints += entry.points;
    if (entry.applied) anyApplied = true;
    if (entry.reason === 'below_minimum') anyBelowMinimum = true;
  }

  if (!anyApplied) {
    return {
      points: 0,
      uncappedPoints: 0,
      capped: false,
      awarded: false,
      ...(anyBelowMinimum ? { reason: 'below_minimum' as const } : {}),
      breakdown,
    };
  }

  const ceiling = input.maxPointsPerSale;
  const capped = ceiling !== undefined && uncappedPoints > ceiling;

  return {
    points: capped ? ceiling : uncappedPoints,
    uncappedPoints,
    capped,
    awarded: true,
    breakdown,
  };
}

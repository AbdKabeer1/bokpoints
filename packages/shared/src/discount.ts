/**
 * The basket discount's maths (D-115, D-131): one rule per store, a basket
 * threshold, and a fixed amount or a percent off. Pure functions — the
 * same maths runs in the quote, the till's verification and the confirm.
 *
 * The store funds the discount in its own till (D-130); Poket never
 * settles it. A discount can never exceed the basket itself.
 */
export type DiscountKind = 'fixed_cents' | 'percent';

export interface DiscountRuleLike {
  thresholdCents: number;
  kind: DiscountKind;
  /** fixed_cents: cents off. percent: thousandths of a percent (100_000 = 100%). */
  value: number;
}

/** The discount a basket earns, in cents — zero below the threshold. */
export function discountFor(rule: DiscountRuleLike, amountBeforeDiscountCents: number): number {
  if (amountBeforeDiscountCents < rule.thresholdCents) return 0;
  if (rule.kind === 'fixed_cents') return Math.min(rule.value, amountBeforeDiscountCents);
  return Math.min(Math.floor((amountBeforeDiscountCents * rule.value) / 100_000), amountBeforeDiscountCents);
}

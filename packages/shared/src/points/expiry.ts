const EXPIRY_MONTHS = 3;

/**
 * Points expire 3 months after the day they were earned (FR-PTS-10, AC-6).
 *
 * If the target month is shorter than the earn day, clamp to that month's
 * last day: 31 January + 3 months -> 30 April. Clamping never expires points
 * early, and the FRD example (2 June -> 2 September) is unaffected.
 *
 * Returns UTC midnight of the expiry day.
 */
export function expiryDateForEarn(earnedAt: Date): Date {
  const year = earnedAt.getUTCFullYear();
  const month = earnedAt.getUTCMonth();
  const day = earnedAt.getUTCDate();

  const targetMonthStart = new Date(Date.UTC(year, month + EXPIRY_MONTHS, 1));
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0),
  ).getUTCDate();

  const result = new Date(targetMonthStart);
  result.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return result;
}

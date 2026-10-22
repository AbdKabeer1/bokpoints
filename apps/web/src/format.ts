import { MAX_AMOUNT_CENTS } from '@bokpoints/shared';

/**
 * Only the whitespace a scanner adds around a code is removed. The case is
 * kept: the server matches credential identifiers exactly.
 */
export function normalizeScan(raw: string): string {
  return raw.replace(/[\r\n\t]/g, '').trim();
}

/**
 * "12,50" or "12.50" (or "12") into whole cents, without floating point.
 * Anything a till never types, and anything above the API's limit, is null.
 */
export function parseAmountToCents(raw: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(raw.trim());
  if (!match) return null;

  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) return null;

  return cents;
}

/** A UTC date like 2027-01-22 as "22 Jan 2027"; anything else passes through. */
export function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

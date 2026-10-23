import { MAX_AMOUNT_CENTS } from '@bokpoints/shared';

/**
 * "12,50" or "12.50" (or "12") into whole cents, without floating point.
 * Anything the portal never types, and anything above the API's limit, is
 * null.
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

/**
 * "1" one point per euro, "0.5" half a point per euro, "1,25" and so on,
 * into thousandths without floating point. Whole numbers only above that.
 */
export function parsePerEuro(raw: string): number | null {
  const match = /^(\d{1,4})(?:[.,](\d{1,3}))?$/.exec(raw.trim());
  if (!match) return null;
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  const thousandths = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  if (!Number.isSafeInteger(thousandths)) return null;
  return thousandths;
}

/** The reverse: thousandths back into "1" or "0.5" for display. */
export function perEuroText(thousandths: number): string {
  if (thousandths % 1000 === 0) return String(thousandths / 1000);
  return (thousandths / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export function euroText(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const sign = cents < 0 ? '−' : '';
  const value = Math.abs(cents);
  const whole = Math.floor(value / 100);
  const fraction = String(value % 100).padStart(2, '0');
  return `${sign}${whole}.${fraction}`;
}

/** A UTC timestamp as "22 Jan 2027, 14:05 UTC". */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })}, ${date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })} UTC`;
}

/** A light client-side check; the server validates the address properly. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

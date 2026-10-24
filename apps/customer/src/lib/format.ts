/** A UTC date like 2027-01-22 as "22 Jan 2027"; anything else passes through. */
export function formatDate(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "in 12 days", "tomorrow", "today" or "expired" for a UTC expiry date.
 *
 * Counting whole UTC days means a customer opening the app at 23:59 gets the
 * same answer as one opening it at 08:00 (FR-CUS-8).
 */
export function expiryLabel(iso: string, now: Date = new Date()): string {
  const target = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target)) return iso;

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((target - today) / DAY_MS);

  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

const TYPE_LABELS: Record<string, string> = {
  earn: 'Earned',
  expire: 'Expired',
  adjust: 'Adjusted',
  clawback: 'Clawback',
  redeem: 'Redeemed',
};

/** A ledger type in words the customer understands; unknown types stay visible. */
export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/**
 * The email code field: digits only. Supabase's OTP length is a project
 * setting (6 to 10 digits), so the field follows the server rather than
 * assuming six.
 */
export function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 10);
}

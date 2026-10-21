import type { ConsumedBatch, PointsBatch } from './types.js';

/**
 * Oldest points are used first (FIFO). Batches are ordered by expiry date,
 * then by entry id, so the order is deterministic when two batches share a
 * date. With a uniform 3-month expiry, oldest-expiring is also oldest-earned.
 */
export function consumePointsFIFO(
  batches: PointsBatch[],
  amount: number,
): { consumed: ConsumedBatch[]; shortfall: number } {
  const ordered = [...batches]
    .filter((batch) => batch.remainingPoints > 0)
    .sort((a, b) => {
      const aExpiry = a.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bExpiry = b.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (aExpiry !== bExpiry) return aExpiry - bExpiry;
      return a.entryId.localeCompare(b.entryId);
    });

  let remaining = amount;
  const consumed: ConsumedBatch[] = [];

  for (const batch of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(batch.remainingPoints, remaining);
    consumed.push({ entryId: batch.entryId, points: take });
    remaining -= take;
  }

  return { consumed, shortfall: remaining };
}

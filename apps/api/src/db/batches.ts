import { and, eq, sql } from 'drizzle-orm';
import { consumePointsFIFO, type PointsBatch } from '@bokpoints/shared';
import type { Database } from './client.js';
import { pointsBatches } from './schema.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Records the batch of points created by one award.
 *
 * The live counter lives here rather than on the ledger entry, because the
 * ledger is append-only: an entry is never edited or deleted (FRD section 3).
 * This table is a derived cache, the same kind as `points_balances`.
 */
export async function createBatch(
  tx: Tx,
  input: {
    earnEntryId: string;
    customerId: string;
    storeId: string;
    originalPoints: number;
    expiresAt: Date;
  },
): Promise<void> {
  await tx.insert(pointsBatches).values({
    earnEntryId: input.earnEntryId,
    customerId: input.customerId,
    storeId: input.storeId,
    originalPoints: input.originalPoints,
    remainingPoints: input.originalPoints,
    expiresAt: input.expiresAt,
  });
}

/**
 * The batches that still hold points, in the order they are consumed:
 * oldest first (FR-STO-7).
 */
export async function listBatches(
  tx: Tx,
  customerId: string,
  storeId: string,
): Promise<PointsBatch[]> {
  const rows = await tx
    .select()
    .from(pointsBatches)
    .where(
      and(
        eq(pointsBatches.customerId, customerId),
        eq(pointsBatches.storeId, storeId),
        sql`${pointsBatches.remainingPoints} > 0`,
      ),
    )
    // Row locks keep two concurrent drawdowns from reading the same
    // remaining counts and computing consumption plans that drive a batch
    // negative: the second plan is computed after the first transaction
    // commits, so the FIFO consumption always sees the real numbers.
    .for('update');

  return rows.map((row) => ({
    entryId: row.earnEntryId,
    points: row.originalPoints,
    remainingPoints: row.remainingPoints,
    expiresAt: row.expiresAt,
  }));
}

/**
 * Takes points out of the customer's batches, oldest first, and reduces the
 * remaining points of each batch it touched.
 *
 * This is what keeps the expiry job honest: it expires a batch's remaining
 * points, so anything removed earlier has to come off the batch, or the
 * points would be taken twice.
 *
 * Returns how much was actually drawn. It is less than `points` when the
 * customer has no batched points left, for example when the rest of the
 * removal falls on points that were added by an adjustment and so have no
 * batch and no expiry.
 */
export async function drawDownBatches(
  tx: Tx,
  customerId: string,
  storeId: string,
  points: number,
): Promise<number> {
  if (points <= 0) return 0;

  const batches = await listBatches(tx, customerId, storeId);
  const { consumed } = consumePointsFIFO(batches, points);

  let drawn = 0;
  for (const batch of consumed) {
    await tx
      .update(pointsBatches)
      .set({ remainingPoints: sql`${pointsBatches.remainingPoints} - ${batch.points}` })
      .where(eq(pointsBatches.earnEntryId, batch.entryId));
    drawn += batch.points;
  }

  return drawn;
}

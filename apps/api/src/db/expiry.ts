import { and, asc, eq, gt, lte } from 'drizzle-orm';
import type { Database } from './client.js';
import { applyGuardedBalanceDelta } from './ledger.js';
import { auditLogEntries, pointsBatches, pointsLedgerEntries } from './schema.js';

const DEFAULT_CHUNK_SIZE = 200;

export interface RunExpiryOptions {
  /** The instant the job runs for. Defaults to now. */
  asOf?: Date;
  /** How many batches one transaction takes. */
  chunkSize?: number;
}

export interface ExpiryRunResult {
  expiredEntries: number;
  pointsExpired: number;
}

/**
 * The points expiry job (FR-PTS-10, "the next concrete task").
 *
 * Every `earn` created a batch with its expiry date and its remaining
 * points. This job walks the batches whose time is up and still hold
 * points, and writes one `expire` ledger entry per batch, taking the same
 * points off the cached balance.
 *
 * It is safe to run twice on the same day, and safe to run twice at the
 * same instant:
 *
 * - Only batches with `remaining_points > 0` are taken, and the taken
 *   batches are set to exactly zero in the same transaction, so a re-run
 *   finds nothing left. Points already removed by an adjustment or a
 *   fraud clawback were drawn off the batches first (`drawDownBatches`),
 *   so only the true remainder is ever expired.
 * - The batches are locked `FOR UPDATE` exactly like adjustments lock
 *   theirs: a second concurrent run blocks on the lock and re-evaluates
 *   its query after the first one commits, so it sees zeros and moves on.
 *
 * Each chunk is its own transaction; a failure leaves the untouched batches
 * for the next run and one audit entry per batch, with no actor, because
 * the job is the system acting, not a person.
 */
export async function runExpiry(
  db: Database,
  options: RunExpiryOptions = {},
): Promise<ExpiryRunResult> {
  const asOf = options.asOf ?? new Date();
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;

  let expiredEntries = 0;
  let pointsExpired = 0;

  for (;;) {
    const expiredInChunk = await db.transaction(async (tx) => {
      const dueBatches = await tx
        .select({
          id: pointsBatches.id,
          customerId: pointsBatches.customerId,
          storeId: pointsBatches.storeId,
          remainingPoints: pointsBatches.remainingPoints,
          expiresAt: pointsBatches.expiresAt,
        })
        .from(pointsBatches)
        .where(
          and(
            gt(pointsBatches.remainingPoints, 0),
            lte(pointsBatches.expiresAt, asOf),
          ),
        )
        .orderBy(asc(pointsBatches.expiresAt))
        .limit(chunkSize)
        .for('update');

      if (dueBatches.length === 0) return { entries: 0, points: 0 };

      for (const batch of dueBatches) {
        const points = batch.remainingPoints;

        await tx.insert(pointsLedgerEntries).values({
          customerId: batch.customerId,
          storeId: batch.storeId,
          type: 'expire',
          points: -points,
          expiresAt: batch.expiresAt,
        });

        await tx
          .update(pointsBatches)
          .set({ remainingPoints: 0 })
          .where(eq(pointsBatches.id, batch.id));

        await applyGuardedBalanceDelta(tx, batch.customerId, batch.storeId, -points);

        await tx.insert(auditLogEntries).values({
          actorId: null,
          actorRole: null,
          action: 'points.expire',
          storeId: batch.storeId,
          targetType: 'customer',
          targetId: batch.customerId,
          after: { points: -points, batchId: batch.id },
        });

        expiredEntries += 1;
        pointsExpired += points;
      }

      return { entries: dueBatches.length, points: pointsExpired };
    });

    if (expiredInChunk.entries < chunkSize) break;
  }

  return { expiredEntries, pointsExpired };
}

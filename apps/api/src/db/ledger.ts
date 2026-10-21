import { and, eq, sql } from 'drizzle-orm';
import {
  adjustPoints,
  applyFraudClawback,
  calculatePoints,
  expiryDateForEarn,
  type PointsRejectionReason,
  type PointsRule,
} from '@bokpoints/shared';
import type { Database } from './client.js';
import {
  auditLogEntries,
  customerStoreLinks,
  pointsBalances,
  pointsLedgerEntries,
} from './schema.js';

export type LedgerErrorCode =
  | 'BELOW_MINIMUM'
  | 'BALANCE_WOULD_GO_NEGATIVE'
  | 'INVALID_AMOUNT'
  | 'REASON_REQUIRED';

/**
 * A typed failure for an expected error, so the API can map it to a clear
 * message in the UI (AGENT.md section 10).
 */
export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

export interface RecordEarnInput {
  customerId: string;
  storeId: string;
  amountCents: number;
  rule: PointsRule;
  ruleVersion: number;
  idempotencyKey: string;
  scannedAt?: Date;
  staffId?: string;
  deviceId?: string;
}

export interface RecordEarnResult {
  /** null when nothing was awarded, for example below the minimum purchase. */
  entryId: string | null;
  points: number;
  awarded: boolean;
  reason?: PointsRejectionReason;
}

export interface RecordAdjustInput {
  customerId: string;
  storeId: string;
  /** Signed delta: positive adds points, negative removes them. */
  points: number;
  reason: string;
  staffId: string;
}

export interface RecordFraudClawbackInput {
  customerId: string;
  storeId: string;
  /** Signed delta; must be negative, a clawback only removes points. */
  points: number;
  caseNote: string;
  staffId: string;
}

/**
 * A customer's balance at a store. The balance is derived from the ledger
 * and cached for speed (FRD section 3).
 */
export async function getBalance(
  db: Database,
  customerId: string,
  storeId: string,
): Promise<number> {
  const rows = await db
    .select({ balance: pointsBalances.balance })
    .from(pointsBalances)
    .where(and(eq(pointsBalances.customerId, customerId), eq(pointsBalances.storeId, storeId)))
    .limit(1);

  return rows[0]?.balance ?? 0;
}

/**
 * Awards points for a purchase.
 *
 * The ledger entry, the balance update and the audit entry happen in one
 * transaction, so either all three land or none do (FR-PTS-5).
 *
 * Retrying with the same idempotency key returns the original entry and
 * never awards twice (FR-PTS-4, AC-2).
 */
export async function recordEarn(db: Database, input: RecordEarnInput): Promise<RecordEarnResult> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: pointsLedgerEntries.id, points: pointsLedgerEntries.points })
      .from(pointsLedgerEntries)
      .where(
        and(
          eq(pointsLedgerEntries.storeId, input.storeId),
          eq(pointsLedgerEntries.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    const found = existing[0];
    if (found) {
      return { entryId: found.id, points: found.points, awarded: true };
    }

    const calculation = calculatePoints(input.amountCents, input.rule);

    // FR-PTS-2: below the minimum purchase, award zero points and tell the
    // cashier why. Nothing is written to the ledger.
    if (!calculation.awarded) {
      return { entryId: null, points: 0, awarded: false, reason: calculation.reason };
    }

    const scannedAt = input.scannedAt ?? new Date();
    const expiresAt = expiryDateForEarn(scannedAt);

    const inserted = await tx
      .insert(pointsLedgerEntries)
      .values({
        customerId: input.customerId,
        storeId: input.storeId,
        type: 'earn',
        points: calculation.points,
        amountCents: input.amountCents,
        remainingPoints: calculation.points,
        expiresAt,
        ruleVersion: input.ruleVersion,
        staffId: input.staffId,
        deviceId: input.deviceId,
        scannedAt,
        idempotencyKey: input.idempotencyKey,
      })
      .returning({ id: pointsLedgerEntries.id });

    await applyBalanceDelta(tx, input.customerId, input.storeId, calculation.points);

    // FRD 4.3: the first purchase at a store creates the customer-store link.
    await tx
      .insert(customerStoreLinks)
      .values({ customerId: input.customerId, storeId: input.storeId })
      .onConflictDoNothing();

    await tx.insert(auditLogEntries).values({
      actorId: input.staffId,
      action: 'points.award',
      storeId: input.storeId,
      targetType: 'customer',
      targetId: input.customerId,
      after: { points: calculation.points, amountCents: input.amountCents },
    });

    return { entryId: inserted[0]?.id ?? null, points: calculation.points, awarded: true };
  });
}
/**
 * A manual adjustment by an owner or manager. It may never take the balance
 * below zero (FR-PTS-8, AC-11). There is no reversal: the adjustment is the
 * only way to correct a mistake.
 */
export async function recordAdjust(
  db: Database,
  input: RecordAdjustInput,
): Promise<{ entryId: string; balance: number }> {
  if (input.reason.trim().length === 0) {
    throw new LedgerError('REASON_REQUIRED', 'An adjustment requires a reason');
  }

  return db.transaction(async (tx) => {
    const balance = await readBalance(tx, input.customerId, input.storeId);
    const result = adjustPoints(balance, input.points);

    if (!result.ok) {
      throw new LedgerError(result.error.code as LedgerErrorCode, result.error.message);
    }

    const inserted = await tx
      .insert(pointsLedgerEntries)
      .values({
        customerId: input.customerId,
        storeId: input.storeId,
        type: 'adjust',
        points: input.points,
        reason: input.reason,
        staffId: input.staffId,
      })
      .returning({ id: pointsLedgerEntries.id });

    const newBalance = await applyGuardedBalanceDelta(
      tx,
      input.customerId,
      input.storeId,
      input.points,
    );

    await tx.insert(auditLogEntries).values({
      actorId: input.staffId,
      action: 'points.adjust',
      storeId: input.storeId,
      targetType: 'customer',
      targetId: input.customerId,
      before: { balance },
      after: { balance: newBalance, points: input.points },
      reason: input.reason,
    });

    return { entryId: inserted[0]?.id ?? '', balance: newBalance };
  });
}

/**
 * The only action that may take a balance below zero. Admin only, and the
 * case note is required (FR-PTS-8, FRD 4.6, AC-11).
 */
export async function recordFraudClawback(
  db: Database,
  input: RecordFraudClawbackInput,
): Promise<{ entryId: string; balance: number }> {
  if (input.caseNote.trim().length === 0) {
    throw new LedgerError('REASON_REQUIRED', 'A fraud clawback requires a case note');
  }

  return db.transaction(async (tx) => {
    const balance = await readBalance(tx, input.customerId, input.storeId);
    const result = applyFraudClawback(balance, input.points);

    if (!result.ok) {
      throw new LedgerError(result.error.code as LedgerErrorCode, result.error.message);
    }

    const inserted = await tx
      .insert(pointsLedgerEntries)
      .values({
        customerId: input.customerId,
        storeId: input.storeId,
        type: 'fraud_clawback',
        points: input.points,
        reason: input.caseNote,
        staffId: input.staffId,
      })
      .returning({ id: pointsLedgerEntries.id });

    const newBalance = await applyBalanceDelta(
      tx,
      input.customerId,
      input.storeId,
      input.points,
    );

    // FRD 4.6: the link is marked as under fraud review.
    await tx
      .update(customerStoreLinks)
      .set({ status: 'under_fraud_review' })
      .where(
        and(
          eq(customerStoreLinks.customerId, input.customerId),
          eq(customerStoreLinks.storeId, input.storeId),
        ),
      );

    await tx.insert(auditLogEntries).values({
      actorId: input.staffId,
      action: 'points.fraud_clawback',
      storeId: input.storeId,
      targetType: 'customer',
      targetId: input.customerId,
      before: { balance },
      after: { balance: newBalance, points: input.points },
      reason: input.caseNote,
    });

    return { entryId: inserted[0]?.id ?? '', balance: newBalance };
  });
}

/**
 * Reads the balance inside the transaction that is about to change it, so
 * the check and the write see the same value.
 */
async function readBalance(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  customerId: string,
  storeId: string,
): Promise<number> {
  const rows = await tx
    .select({ balance: pointsBalances.balance })
    .from(pointsBalances)
    .where(and(eq(pointsBalances.customerId, customerId), eq(pointsBalances.storeId, storeId)))
    .limit(1);

  return rows[0]?.balance ?? 0;
}

/**
 * Adds a signed delta to the cached balance, with no lower bound. Used by
 * `earn` and by `fraud_clawback`, the one action that may take a balance
 * below zero.
 *
 * The update is a single atomic statement, so two awards at the same instant
 * cannot lose a delta.
 */
async function applyBalanceDelta(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  customerId: string,
  storeId: string,
  points: number,
): Promise<number> {
  const updated = await tx.execute(sql`
    INSERT INTO points_balances (customer_id, store_id, balance, updated_at)
    VALUES (${customerId}, ${storeId}, ${points}, now())
    ON CONFLICT (customer_id, store_id) DO UPDATE
      SET balance = points_balances.balance + ${points}, updated_at = now()
    RETURNING balance
  `);

  return Number(updated.rows[0]?.balance ?? 0);
}

/**
 * Adds a signed delta to the cached balance, refusing a delta that would
 * take the balance below zero. Used by `adjust`.
 *
 * The guard is part of the UPDATE statement, so two cashiers adjusting at
 * the same instant cannot both pass the check and drive the balance
 * negative: Postgres re-evaluates the guard after the row lock is taken.
 */
async function applyGuardedBalanceDelta(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  customerId: string,
  storeId: string,
  points: number,
): Promise<number> {
  if (points >= 0) {
    // Adding points can never break the invariant.
    return applyBalanceDelta(tx, customerId, storeId, points);
  }

  const updated = await tx.execute(sql`
    UPDATE points_balances
    SET balance = balance + ${points}, updated_at = now()
    WHERE customer_id = ${customerId}
      AND store_id = ${storeId}
      AND balance + ${points} >= 0
    RETURNING balance
  `);

  if (updated.rows.length === 0) {
    throw new LedgerError(
      'BALANCE_WOULD_GO_NEGATIVE',
      'An adjustment may not take the balance below zero',
    );
  }

  return Number(updated.rows[0]?.balance ?? 0);
}

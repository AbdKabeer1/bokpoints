import { and, eq, sql } from 'drizzle-orm';
import {
  adjustPoints,
  applyFraudClawback,
  calculatePoints,
  calculatePurchase,
  expiryDateForEarn,
  type EarningRule,
  type PointsRejectionReason,
  type PointsRule,
  type RuleBreakdownEntry,
} from '@bokpoints/shared';
import { createBatch, drawDownBatches } from './batches.js';
import type { Database } from './client.js';
import {
  auditLogEntries,
  customerStoreLinks,
  customers,
  pointsBalances,
  pointsLedgerEntries,
  sales,
  storeLocations,
  stores,
} from './schema.js';
import { isUniqueViolation } from './errors.js';

export type LedgerErrorCode =
  | 'BELOW_MINIMUM'
  | 'BALANCE_WOULD_GO_NEGATIVE'
  | 'INVALID_AMOUNT'
  | 'REASON_REQUIRED'
  | 'STORE_NOT_AWARDING'
  | 'CUSTOMER_NOT_FOUND'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'LOCATION_REQUIRED'
  | 'LOCATION_INVALID'
  | 'SALE_NOT_FOUND'
  | 'SALE_ALREADY_REVERSED';

/**
 * The store states in which awarding is allowed. A paused store still
 * awards (D-042); a suspended or offboarded store does not (FR-PTS-6).
 */
const AWARDING_STORE_STATUSES = new Set(['active', 'paused']);

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

export interface AwardProgram {
  rules: EarningRule[];
  maxPointsPerSale?: number;
}

type AwardCalculation = ReturnType<typeof calculatePoints> & {
  breakdown?: RuleBreakdownEntry[];
};

/** The store's rule set when it has one, else the legacy single rule. */
function calculateAward(input: {
  amountCents: number;
  rule?: PointsRule;
  program?: AwardProgram;
  visitNumber?: number;
}): AwardCalculation {
  if (input.program !== undefined) {
    return calculatePurchase({
      lines: [{ amountCents: input.amountCents }],
      rules: input.program.rules,
      ...(input.program.maxPointsPerSale === undefined
        ? {}
        : { maxPointsPerSale: input.program.maxPointsPerSale }),
      ...(input.visitNumber === undefined ? {} : { visitNumber: input.visitNumber }),
    });
  }
  if (input.rule !== undefined) return calculatePoints(input.amountCents, input.rule);
  throw new Error('An award needs a rule or a program');
}

function ruleVersionFor(input: { ruleVersion?: number; program?: AwardProgram }): number | null {
  if (input.ruleVersion !== undefined) return input.ruleVersion;
  if (input.program === undefined || input.program.rules.length === 0) return null;
  return Math.max(...input.program.rules.map((rule) => rule.version));
}

/**
 * Only an every-Nth-visit rule needs the visit count; fetching it costs a
 * query, so the count happens just for such programs.
 */
function programCountsVisits(program: AwardProgram | undefined): boolean {
  return program?.rules.some((rule) => rule.type === 'every_nth_visit') ?? false;
}

/** The customer's prior successful purchases at this store (1-based next). */
async function nextVisitNumber(
  executor: Database,
  customerId: string,
  storeId: string,
): Promise<number> {
  const rows = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(pointsLedgerEntries)
    .where(
      and(
        eq(pointsLedgerEntries.customerId, customerId),
        eq(pointsLedgerEntries.storeId, storeId),
        eq(pointsLedgerEntries.type, 'earn'),
      ),
    );
  return (rows[0]?.count ?? 0) + 1;
}

export interface RecordEarnInput {
  customerId: string;
  storeId: string;
  /** What the register charged, before any discount. */
  amountCents: number;
  /** What the customer actually paid (D-129); points follow this. */
  amountPaidCents?: number;
  /** The store's own till receipt reference, when it has one. */
  posReference?: string;
  /** The legacy single per-euro rule; WP3 removes it once every caller uses a program. */
  rule?: PointsRule;
  ruleVersion?: number;
  /** The store's earning program (WP2): rules plus the per-sale ceiling. */
  program?: AwardProgram;
  /** Set internally when a rule counts visits; callers never pass it. */
  visitNumber?: number;
  idempotencyKey: string;
  scannedAt?: Date;
  staffId?: string;
  deviceId?: string;
  /**
   * The branch the purchase happened at (D-103). Required when the store has
   * branches, and refused when the store has none or the branch is not an
   * active one of this store.
   */
  locationId?: string | null;
}

export interface RecordEarnResult {
  /** null when nothing was awarded, for example below the minimum purchase. */
  entryId: string | null;
  /** The sale recorded by this confirm (WP3). Null only on a replay of a
   * pre-WP3 entry that has no sale. */
  saleId: string | null;
  points: number;
  awarded: boolean;
  reason?: PointsRejectionReason | undefined;
  /** True when this request had already been awarded and was replayed. */
  replayed: boolean;
  breakdown?: RuleBreakdownEntry[];
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
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    throw new LedgerError('INVALID_AMOUNT', 'The purchase amount must be a non-negative integer');
  }
  if (input.idempotencyKey.trim().length === 0) {
    throw new LedgerError('INVALID_AMOUNT', 'An award requires an idempotency key');
  }
  // WP3, D-129: points follow the amount actually paid. Overpaying is not
  // a thing at a till, so the paid amount never exceeds the charge; that
  // invariant also keeps `before - discount = paid` true when the basket
  // discount arrives (D-115).
  const paidCents = input.amountPaidCents ?? input.amountCents;
  if (!Number.isInteger(paidCents) || paidCents < 0 || paidCents > input.amountCents) {
    throw new LedgerError(
      'INVALID_AMOUNT',
      'The amount paid must be between zero and the charged amount',
    );
  }

  try {
    return await db.transaction(async (tx) => {
      // FR-PTS-6: a suspended or offboarded store cannot award. A paused
      // store still can, because awarding continues while a store is paused
      // (D-042).
      const store = await tx
        .select({ status: stores.status })
        .from(stores)
        .where(eq(stores.id, input.storeId))
        .limit(1);
      const storeStatus = store[0]?.status;
      if (!storeStatus || !AWARDING_STORE_STATUSES.has(storeStatus)) {
        throw new LedgerError('STORE_NOT_AWARDING', 'This store cannot award points at the moment');
      }

      const customer = await tx
        .select({ status: customers.status })
        .from(customers)
        .where(eq(customers.id, input.customerId))
        .limit(1);
      if (!customer[0] || customer[0].status === 'deleted') {
        throw new LedgerError('CUSTOMER_NOT_FOUND', 'That customer does not exist');
      }

      const existing = await tx
        .select({
          id: pointsLedgerEntries.id,
          points: pointsLedgerEntries.points,
          amountCents: pointsLedgerEntries.amountCents,
          saleId: pointsLedgerEntries.saleId,
        })
        .from(pointsLedgerEntries)
        .where(
          and(
            eq(pointsLedgerEntries.storeId, input.storeId),
            eq(pointsLedgerEntries.customerId, input.customerId),
            eq(pointsLedgerEntries.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      const found = existing[0];
      if (found) {
        // The same key with a different amount is not a retry, it is a
        // mistake, and it must not look like a successful award.
        if (found.amountCents !== null && found.amountCents !== input.amountCents) {
          throw new LedgerError(
            'IDEMPOTENCY_KEY_REUSED',
            'That idempotency key was already used for a different amount',
          );
        }
        return {
          entryId: found.id,
          saleId: found.saleId,
          points: found.points,
          awarded: found.points > 0,
          replayed: true,
        };
      }

      // D-103, D-104: a store with branches must say which one the award is
      // at; a store without them never has one. Checked after the replay
      // branch so a retry is answered whatever has changed since.
      const activeLocations = await tx
        .select({ id: storeLocations.id })
        .from(storeLocations)
        .where(and(eq(storeLocations.storeId, input.storeId), eq(storeLocations.status, 'active')));
      const locationId = input.locationId ?? null;
      if (locationId !== null) {
        if (!activeLocations.some((location) => location.id === locationId)) {
          throw new LedgerError(
            'LOCATION_INVALID',
            'That branch does not exist or is not open at this store',
          );
        }
      } else if (activeLocations.length > 0) {
        throw new LedgerError(
          'LOCATION_REQUIRED',
          'This store has branches, so the award needs to say which one',
        );
      }

      const calculation = calculateAward({
        ...input,
        // D-129: the engine prices what was paid, not what was charged.
        amountCents: paidCents,
        ...(programCountsVisits(input.program)
          ? { visitNumber: await nextVisitNumber(tx, input.customerId, input.storeId) }
          : {}),
      });
      const ruleVersion = ruleVersionFor(input);

      const scannedAt = input.scannedAt ?? new Date();

      // WP3: every confirm records the sale, even one that awarded nothing —
      // the payment happened, and the sale history is the store's record of
      // trade. The discount stays zero until the basket discount ships
      // behind the rotating-QR gate (D-115, D-133).
      const saleRows = await tx
        .insert(sales)
        .values({
          storeId: input.storeId,
          locationId,
          customerId: input.customerId,
          staffId: input.staffId,
          deviceId: input.deviceId,
          amountBeforeDiscountCents: input.amountCents,
          discountCents: 0,
          amountPaidCents: paidCents,
          rulesApplied: calculation.breakdown ?? null,
          posReference: input.posReference ?? null,
          idempotencyKey: input.idempotencyKey,
        })
        .returning({ id: sales.id });
      const saleId = saleRows[0]?.id ?? null;

      // FR-PTS-2: below the minimum purchase, award zero points and tell the
      // cashier why. A zero-value purchase is the same: nothing is written
      // to the ledger and no customer-store link is created.
      //
      // The exception is an every-Nth-visit programme: the visits themselves
      // are the thing being counted, so a visit that awards nothing is still
      // a ledger fact. Without a zero-point entry the Nth visit would never
      // arrive (WP2).
      if (!calculation.awarded) {
        if (programCountsVisits(input.program)) {
          const visitRows = await tx
            .insert(pointsLedgerEntries)
            .values({
              customerId: input.customerId,
              storeId: input.storeId,
              type: 'earn',
              points: 0,
              amountCents: input.amountCents,
              saleId,
              ruleVersion,
              rulesApplied: calculation.breakdown ?? null,
              reason: calculation.reason,
              staffId: input.staffId,
              deviceId: input.deviceId,
              scannedAt,
              locationId,
              idempotencyKey: input.idempotencyKey,
            })
            .returning({ id: pointsLedgerEntries.id });
          const visitRow = visitRows[0];
          if (!visitRow) throw new Error('Could not record the visit');

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
            after: { points: 0, amountCents: input.amountCents, visitOnly: true },
          });

          return {
            entryId: visitRow.id,
            saleId,
            points: 0,
            awarded: false,
            reason: calculation.reason,
            replayed: false,
          };
        }

        return {
          entryId: null,
          saleId,
          points: 0,
          awarded: false,
          reason: calculation.reason,
          replayed: false,
        };
      }

      const expiresAt = expiryDateForEarn(scannedAt);

      const inserted = await tx
        .insert(pointsLedgerEntries)
        .values({
          customerId: input.customerId,
          storeId: input.storeId,
          type: 'earn',
          points: calculation.points,
          amountCents: input.amountCents,
          saleId,
          expiresAt,
          ruleVersion,
          rulesApplied: calculation.breakdown ?? null,
          staffId: input.staffId,
          deviceId: input.deviceId,
          scannedAt,
          locationId,
          idempotencyKey: input.idempotencyKey,
        })
        .returning({ id: pointsLedgerEntries.id });

      // FR-PTS-10: the award creates a batch that records the expiry date and
      // the remaining points.
      await createBatch(tx, {
        earnEntryId: inserted[0]?.id ?? '',
        customerId: input.customerId,
        storeId: input.storeId,
        originalPoints: calculation.points,
        expiresAt,
      });

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
        after: {
          points: calculation.points,
          amountCents: input.amountCents,
          amountPaidCents: paidCents,
          saleId,
        },
      });

      return {
        entryId: inserted[0]?.id ?? null,
        saleId,
        points: calculation.points,
        awarded: true,
        replayed: false,
        breakdown: calculation.breakdown ?? [],
      };
    });
  } catch (error) {
    // Two requests with the same key can both pass the SELECT above. The
    // unique index stops the second one from awarding twice, but the loser
    // must still get the original award back rather than a raw database
    // error: a double tap on the Cashier screen is normal (FR-PTS-4).
    if (!isUniqueViolation(error)) throw error;

    const winner = await db
      .select({
        id: pointsLedgerEntries.id,
        points: pointsLedgerEntries.points,
        amountCents: pointsLedgerEntries.amountCents,
        saleId: pointsLedgerEntries.saleId,
      })
      .from(pointsLedgerEntries)
      .where(
        and(
          eq(pointsLedgerEntries.storeId, input.storeId),
          eq(pointsLedgerEntries.customerId, input.customerId),
          eq(pointsLedgerEntries.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    const found = winner[0];
    if (!found) throw error;

    // D-092 applies on the race path too: the loser of two concurrent
    // awards with the same key but a different amount is a mistake, and
    // must not look like a replay of the winner.
    if (found.amountCents !== null && found.amountCents !== input.amountCents) {
      throw new LedgerError(
        'IDEMPOTENCY_KEY_REUSED',
        'That idempotency key was already used for a different amount',
      );
    }

    return {
      entryId: found.id,
      saleId: found.saleId,
      points: found.points,
      awarded: true,
      replayed: true,
    };
  }
}


export interface PreviewEarnInput {
  customerId: string;
  storeId: string;
  amountCents: number;
  /** What the customer will actually pay (D-129); the quote prices this. */
  amountPaidCents?: number;
  /** The legacy single per-euro rule. */
  rule?: PointsRule;
  /** The store's earning program (WP2). */
  program?: AwardProgram;
  /** Set internally when a rule counts visits; callers never pass it. */
  visitNumber?: number;
  locationId: string | null;
}

export interface PreviewEarnResult {
  points: number;
  awarded: boolean;
  reason?: PointsRejectionReason | undefined;
  /** UTC midnight of the expiry day, or null when nothing will be awarded. */
  expiresAt: Date | null;
  locationId: string | null;
  locationName: string | null;
  breakdown?: RuleBreakdownEntry[];
}

/**
 * What awarding this purchase would do, without doing it — the Cashier
 * screen's confirm step (FR-STO-9).
 *
 * The same checks as `recordEarn`, in the same order, all reads. A preview
 * can never write a ledger entry or change a balance, so it is safe to call
 * on every keystroke of the amount field. A below-minimum purchase is a
 * normal answer (`awarded: false` plus the reason), not an error (FR-PTS-2).
 */
export async function previewEarn(
  db: Database,
  input: PreviewEarnInput,
): Promise<PreviewEarnResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    throw new LedgerError('INVALID_AMOUNT', 'The purchase amount must be a non-negative integer');
  }
  // The quote prices what will be paid (D-129), under the same invariant as
  // the confirm: paid never exceeds the charge.
  const paidCents = input.amountPaidCents ?? input.amountCents;
  if (!Number.isInteger(paidCents) || paidCents < 0 || paidCents > input.amountCents) {
    throw new LedgerError(
      'INVALID_AMOUNT',
      'The amount paid must be between zero and the charged amount',
    );
  }

  const store = await db
    .select({ status: stores.status })
    .from(stores)
    .where(eq(stores.id, input.storeId))
    .limit(1);
  const storeStatus = store[0]?.status;
  if (!storeStatus || !AWARDING_STORE_STATUSES.has(storeStatus)) {
    throw new LedgerError('STORE_NOT_AWARDING', 'This store cannot award points at the moment');
  }

  const customer = await db
    .select({ status: customers.status })
    .from(customers)
    .where(eq(customers.id, input.customerId))
    .limit(1);
  if (!customer[0] || customer[0].status === 'deleted') {
    throw new LedgerError('CUSTOMER_NOT_FOUND', 'That customer does not exist');
  }

  const activeLocations = await db
    .select({ id: storeLocations.id, name: storeLocations.name })
    .from(storeLocations)
    .where(and(eq(storeLocations.storeId, input.storeId), eq(storeLocations.status, 'active')));

  const locationId = input.locationId ?? null;
  let locationName: string | null = null;
  if (locationId !== null) {
    const match = activeLocations.find((location) => location.id === locationId);
    if (!match) {
      throw new LedgerError(
        'LOCATION_INVALID',
        'That branch does not exist or is not open at this store',
      );
    }
    locationName = match.name;
  } else if (activeLocations.length > 0) {
    throw new LedgerError(
      'LOCATION_REQUIRED',
      'This store has branches, so the award needs to say which one',
    );
  }

  const calculation = calculateAward({
    ...input,
    amountCents: paidCents,
    ...(programCountsVisits(input.program)
      ? { visitNumber: await nextVisitNumber(db, input.customerId, input.storeId) }
      : {}),
  });
  if (!calculation.awarded) {
    return {
      points: 0,
      awarded: false,
      reason: calculation.reason,
      expiresAt: null,
      locationId,
      locationName,
      breakdown: calculation.breakdown ?? [],
    };
  }

  return {
    points: calculation.points,
    awarded: true,
    expiresAt: expiryDateForEarn(new Date()),
    locationId,
    locationName,
    breakdown: calculation.breakdown ?? [],
  };
}

/**
 * A manual adjustment by an owner or manager. It may never take the balance
 * below zero (FR-PTS-8, AC-11). There is no reversal: the adjustment is the
 * only way to correct a mistake.
 */
export async function recordAdjust(
  db: Database,
  input: RecordAdjustInput,
): Promise<{ entryId: string | null; balance: number }> {
  if (input.reason.trim().length === 0) {
    throw new LedgerError('REASON_REQUIRED', 'An adjustment requires a reason');
  }

  return db.transaction(async (tx) => {
    const balance = await readBalance(tx, input.customerId, input.storeId);
    const result = adjustPoints(balance, input.points);

    if (!result.ok) {
      throw new LedgerError(result.error.code as LedgerErrorCode, result.error.message);
    }

    // Removing points takes them off the customer's batches, so the expiry
    // job does not expire them a second time.
    if (input.points < 0) {
      await drawDownBatches(tx, input.customerId, input.storeId, -input.points);
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

    return { entryId: inserted[0]?.id ?? null, balance: newBalance };
  });
}

/**
 * The only action that may take a balance below zero. Admin only, and the
 * case note is required (FR-PTS-8, FRD 4.6, AC-11).
 */
export async function recordFraudClawback(
  db: Database,
  input: RecordFraudClawbackInput,
): Promise<{ entryId: string | null; balance: number }> {
  if (input.caseNote.trim().length === 0) {
    throw new LedgerError('REASON_REQUIRED', 'A fraud clawback requires a case note');
  }

  return db.transaction(async (tx) => {
    const balance = await readBalance(tx, input.customerId, input.storeId);
    const result = applyFraudClawback(balance, input.points);

    if (!result.ok) {
      throw new LedgerError(result.error.code as LedgerErrorCode, result.error.message);
    }

    // A clawback takes points off the batches too. It may go below zero, so
    // it can take more than the batches hold.
    if (input.points < 0) {
      await drawDownBatches(tx, input.customerId, input.storeId, -input.points);
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

    const newBalance = await applyBalanceDelta(tx, input.customerId, input.storeId, input.points);

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

    return { entryId: inserted[0]?.id ?? null, balance: newBalance };
  });
}

export interface ReverseSaleInput {
  saleId: string;
  storeId: string;
  staffId: string;
  reason?: string;
}

export interface ReverseSaleResult {
  /** null when the sale had awarded nothing, so there was nothing to undo. */
  reversalEntryId: string | null;
  reversedPoints: number;
  balance: number;
}

/**
 * Reverses one confirmed sale (WP3, D-131): the points of the sale's earn
 * entry come back off, the reversal entry names the entry it reverses, and
 * the sale is marked reversed so it cannot happen twice.
 *
 * Like an adjustment, a reversal may never take the balance below zero —
 * if the customer already spent the points, only an admin's fraud
 * clawback may go under. Everything happens in one transaction: either
 * the reversal entry, the balance, the batch draw-down and the sale
 * status all land, or none of them do.
 */
export async function reverseSale(db: Database, input: ReverseSaleInput): Promise<ReverseSaleResult> {
  return db.transaction(async (tx) => {
    const saleRows = await tx
      .select({
        id: sales.id,
        customerId: sales.customerId,
        status: sales.status,
      })
      .from(sales)
      .where(and(eq(sales.id, input.saleId), eq(sales.storeId, input.storeId)))
      .limit(1);
    const sale = saleRows[0];
    if (!sale) {
      throw new LedgerError('SALE_NOT_FOUND', 'That sale does not exist at this store');
    }
    if (sale.status === 'reversed') {
      throw new LedgerError('SALE_ALREADY_REVERSED', 'That sale was already reversed');
    }

    const earnRows = await tx
      .select({ id: pointsLedgerEntries.id, points: pointsLedgerEntries.points })
      .from(pointsLedgerEntries)
      .where(
        and(
          eq(pointsLedgerEntries.saleId, input.saleId),
          eq(pointsLedgerEntries.type, 'earn'),
          sql`${pointsLedgerEntries.points} > 0`,
        ),
      )
      .limit(1);
    const earn = earnRows[0];
    const reason = input.reason?.trim() || 'Sale reversed at the till';

    // A sale that awarded nothing (below every minimum) reverses to
    // nothing: the status flip and the audit entry are the whole action.
    if (!earn) {
      await tx.update(sales).set({ status: 'reversed' }).where(eq(sales.id, input.saleId));
      const balance = await readBalance(tx, sale.customerId, input.storeId);
      await tx.insert(auditLogEntries).values({
        actorId: input.staffId,
        action: 'sale.reversal',
        storeId: input.storeId,
        targetType: 'sale',
        targetId: input.saleId,
        before: { status: 'completed', balance },
        after: { status: 'reversed', points: 0 },
        reason,
      });
      return { reversalEntryId: null, reversedPoints: 0, balance };
    }

    const points = -earn.points;
    const balanceBefore = await readBalance(tx, sale.customerId, input.storeId);

    // Removing points takes them off the batches too, so the expiry job
    // cannot expire them later.
    await drawDownBatches(tx, sale.customerId, input.storeId, earn.points);

    const inserted = await tx
      .insert(pointsLedgerEntries)
      .values({
        customerId: sale.customerId,
        storeId: input.storeId,
        type: 'reversal',
        points,
        reversalOf: earn.id,
        saleId: input.saleId,
        staffId: input.staffId,
        reason,
      })
      .returning({ id: pointsLedgerEntries.id });

    // The guarded delta refuses a reversal that would take the balance
    // below zero; the whole transaction then rolls back and the sale
    // stays completed.
    const newBalance = await applyGuardedBalanceDelta(tx, sale.customerId, input.storeId, points);

    await tx.update(sales).set({ status: 'reversed' }).where(eq(sales.id, input.saleId));

    await tx.insert(auditLogEntries).values({
      actorId: input.staffId,
      action: 'sale.reversal',
      storeId: input.storeId,
      targetType: 'sale',
      targetId: input.saleId,
      before: { balance: balanceBefore },
      after: { balance: newBalance, points },
      reason,
    });

    return { reversalEntryId: inserted[0]?.id ?? null, reversedPoints: points, balance: newBalance };
  });
}

/**
 * Reads the balance inside the transaction that is about to change it, so
 * the check and the write see the same value.
 */
export async function readBalance(
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
export async function applyGuardedBalanceDelta(
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

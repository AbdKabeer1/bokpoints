import { and, eq, sql } from 'drizzle-orm';
import {
  adjustPoints,
  applyFraudClawback,
  calculatePoints,
  calculatePurchase,
  discountFor,
  type DiscountKind,
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
  consumedDiscountProofs,
  discountRules,
  sales,
  storeLocations,
  storeRewards,
  stores,
} from './schema.js';
import { isUniqueViolation } from './errors.js';
import { checkDiscountProof } from './discount-proof.js';

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
  | 'SALE_ALREADY_REVERSED'
  | 'REWARD_NOT_FOUND'
  | 'REWARD_NOT_ACTIVE'
  | 'REWARD_NOT_AFFORDABLE'
  | 'REWARD_LIMIT_REACHED'
  | 'PROOF_INVALID'
  | 'PROOF_EXPIRED'
  | 'PROOF_ALREADY_USED'
  | 'PROOF_CUSTOMER_MISMATCH'
  | 'PROOF_STORE_MISMATCH'
  | 'PROOF_BELOW_THRESHOLD';

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
  /** Pay for a catalog reward inside this same confirm (D-138). */
  redeemRewardId?: string;
  /** The customer's rotating discount code, consumed by this confirm (D-133). */
  discountProof?: string;
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

/** What a redemption took: the reward and the (negative) points it cost. */
export interface RedeemedReward {
  rewardId: string;
  name: string;
  pointsCost: number;
}

/** A ledger type or a transaction: both answer the same read queries. */
type Queryable = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/** The day the per-customer reward limit counts in (D-144). The pilot's
 * shops are in Finland, so their local day is Helsinki's — UTC midnight
 * would land at 2 or 3 in the morning and let a late-open shop hand out
 * the same reward twice in one evening. One timezone for the platform in
 * the MVP; a per-store timezone arrives with international stores. */
export const REWARD_DAY_TIMEZONE = 'Europe/Helsinki';

/**
 * How many times a customer took one reward today — today in the store's
 * local day (D-144) — for the per-customer-per-day limit (D-138). Read-only.
 */
export async function rewardTakesToday(
  db: Queryable,
  customerId: string,
  storeId: string,
  rewardId: string,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pointsLedgerEntries)
    .where(
      and(
        eq(pointsLedgerEntries.type, 'redeem'),
        eq(pointsLedgerEntries.rewardId, rewardId),
        eq(pointsLedgerEntries.customerId, customerId),
        eq(pointsLedgerEntries.storeId, storeId),
        // Both sides in Helsinki's wall-clock day, computed in the database
        // so the count and the ledger's timestamps cannot drift.
        sql`(${pointsLedgerEntries.createdAt} at time zone ${REWARD_DAY_TIMEZONE})::date
            = (now() at time zone ${REWARD_DAY_TIMEZONE})::date`,
      ),
    );
  return rows[0]?.n ?? 0;
}

/**
 * Takes a row lock on the customer's balance at this store, creating a
 * zero row first when there is none. Every redemption holds this lock from
 * before the limit count until the write lands, so two tills confirming
 * for one customer at the same instant cannot both pass the same check —
 * the second waits, then sees the first's redeem entry.
 *
 * Taking this lock first also fixes the lock order across the write paths
 * (balance row, then batches), so a redemption racing an adjustment cannot
 * deadlock. Used by `adjust` and the fraud clawback for the same reason.
 */
async function lockCustomerBalance(tx: Queryable, customerId: string, storeId: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO points_balances (customer_id, store_id, balance, updated_at)
    VALUES (${customerId}, ${storeId}, 0, now())
    ON CONFLICT (customer_id, store_id) DO NOTHING
  `);
  await tx.execute(sql`
    SELECT balance FROM points_balances
    WHERE customer_id = ${customerId} AND store_id = ${storeId}
    FOR UPDATE
  `);
}

/** Turns a failed proof check into the ledger error the till can quote. */
function proofError(reason: 'invalid' | 'expired' | 'customer_mismatch' | 'store_mismatch'): LedgerError {
  switch (reason) {
    case 'expired':
      return new LedgerError('PROOF_EXPIRED', 'That discount code has expired');
    case 'customer_mismatch':
      return new LedgerError('PROOF_CUSTOMER_MISMATCH', 'That discount code belongs to a different customer');
    case 'store_mismatch':
      return new LedgerError('PROOF_STORE_MISMATCH', 'That discount code is not for this store');
    default:
      return new LedgerError('PROOF_INVALID', 'That discount code is not recognised');
  }
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
  /** The reward paid for in this confirm (D-138), or none. */
  redeemed: RedeemedReward | null;
  /** What the basket discount took off this sale (D-133), zero when none. */
  discountCents: number;
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

      /**
       * The receipt a replayed confirm still owes its caller (D-138): the
       * reward the sale's redeem entry paid for, rebuilt from the ledger.
       */
      const redeemedForSale = async (saleId: string | null): Promise<RedeemedReward | null> => {
        if (saleId === null) return null;
        const rows = await tx
          .select({
            rewardId: pointsLedgerEntries.rewardId,
            points: pointsLedgerEntries.points,
            name: storeRewards.name,
          })
          .from(pointsLedgerEntries)
          .innerJoin(storeRewards, eq(storeRewards.id, pointsLedgerEntries.rewardId))
          .where(
            and(eq(pointsLedgerEntries.saleId, saleId), eq(pointsLedgerEntries.type, 'redeem')),
          )
          .limit(1);
        const row = rows[0];
        if (!row || row.rewardId === null) return null;
        return { rewardId: row.rewardId, name: row.name, pointsCost: row.points };
      };

      const existing = await tx
        .select({
          id: pointsLedgerEntries.id,
          points: pointsLedgerEntries.points,
          amountCents: pointsLedgerEntries.amountCents,
          saleId: pointsLedgerEntries.saleId,
          saleDiscountCents: sales.discountCents,
        })
        .from(pointsLedgerEntries)
        .leftJoin(sales, eq(sales.id, pointsLedgerEntries.saleId))
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
          redeemed: await redeemedForSale(found.saleId),
          discountCents: found.saleDiscountCents ?? 0,
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

      // D-138: the reward is checked before anything is written, under the
      // same store scope as everything else here.
      let reward: {
        id: string;
        name: string;
        pointsCost: number;
        perCustomerPerDayLimit: number | null;
      } | null = null;
      if (input.redeemRewardId !== undefined) {
        const rewardRows = await tx
          .select({
            id: storeRewards.id,
            name: storeRewards.name,
            pointsCost: storeRewards.pointsCost,
            active: storeRewards.active,
            perCustomerPerDayLimit: storeRewards.perCustomerPerDayLimit,
          })
          .from(storeRewards)
          .where(
            and(eq(storeRewards.id, input.redeemRewardId), eq(storeRewards.storeId, input.storeId)),
          )
          .limit(1);
        const foundReward = rewardRows[0];
        if (!foundReward) {
          throw new LedgerError('REWARD_NOT_FOUND', 'That reward does not exist at this store');
        }
        if (!foundReward.active) {
          throw new LedgerError('REWARD_NOT_ACTIVE', 'That reward is not offered any more');
        }
        // The per-day limit is checked inside `redeemWith`, behind the
        // balance lock, so two tills cannot both pass it.
        reward = foundReward;
      }

      // D-133: the basket discount, gated behind the rotating proof. The
      // code is checked and consumed inside this transaction — one code,
      // one sale — and the discount is the store's to fund (D-130).
      let discountCents = 0;
      if (input.discountProof !== undefined) {
        const check = checkDiscountProof(input.discountProof, {
          customerId: input.customerId,
          storeId: input.storeId,
        });
        if (!check.ok) throw proofError(check.reason);

        const ruleRows = await tx
          .select({
            thresholdCents: discountRules.thresholdCents,
            kind: discountRules.kind,
            value: discountRules.value,
          })
          .from(discountRules)
          .where(and(eq(discountRules.storeId, input.storeId), eq(discountRules.active, true)))
          .limit(1);
        const rule = ruleRows[0];
        if (!rule) {
          throw new LedgerError('PROOF_INVALID', 'This store has no discount running');
        }
        // The threshold reads the whole basket, before any discount. The
        // column is text; the CHECK keeps it to the two kinds.
        const kind: DiscountKind = rule.kind === 'percent' ? 'percent' : 'fixed_cents';
        const computed = discountFor(
          { thresholdCents: rule.thresholdCents, kind, value: rule.value },
          input.amountCents,
        );
        if (computed <= 0) {
          throw new LedgerError('PROOF_BELOW_THRESHOLD', 'This purchase is below the discount threshold');
        }

        // The insert is the consumption: the jti is the primary key, so a
        // second confirm with the same code fails here and rolls back.
        try {
          await tx
            .insert(consumedDiscountProofs)
            .values({ jti: check.payload.jti, storeId: input.storeId });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new LedgerError('PROOF_ALREADY_USED', 'That discount code was already used');
          }
          throw error;
        }
        discountCents = computed;

        // The discount is the store's own money (D-130): it must come off
        // what the customer pays, so paid can never sit above the
        // discounted total.
        if (paidCents > input.amountCents - discountCents) {
          throw new LedgerError('INVALID_AMOUNT', 'The amount paid is above the discounted total');
        }
      }

      /**
       * D-138: paying for a reward inside the same confirm as the award.
       * One transaction: both ledger entries, the balance and the sale all
       * land together, or none of them do. The redeem entry carries no
       * idempotency key — the earn entry owns this confirm's key.
       */
      const redeemWith = async (saleId: string | null) => {
        if (reward === null) return { redeemed: null as RedeemedReward | null };

        // One lock for the whole check-then-write: two tills confirming for
        // one customer at the same instant line up here, and the second
        // sees the first's redeem entry (the review's double-redemption race).
        await lockCustomerBalance(tx, input.customerId, input.storeId);
        if (
          reward.perCustomerPerDayLimit !== null &&
          (await rewardTakesToday(tx, input.customerId, input.storeId, reward.id)) >=
            reward.perCustomerPerDayLimit
        ) {
          throw new LedgerError(
            'REWARD_LIMIT_REACHED',
            'This customer has already taken that reward today',
          );
        }

        // The award has already landed (when there was one), so this read
        // is the balance the redemption must fit inside.
        const balanceBefore = await readBalance(tx, input.customerId, input.storeId);
        if (balanceBefore < reward.pointsCost) {
          throw new LedgerError(
            'REWARD_NOT_AFFORDABLE',
            'This customer has not enough points for that reward',
          );
        }
        // Points leave the batches too, so the expiry job cannot expire
        // points the customer has already spent.
        await drawDownBatches(tx, input.customerId, input.storeId, reward.pointsCost);
        await tx.insert(pointsLedgerEntries).values({
          customerId: input.customerId,
          storeId: input.storeId,
          type: 'redeem',
          points: -reward.pointsCost,
          rewardId: reward.id,
          saleId,
          staffId: input.staffId,
          locationId,
          reason: `Reward: ${reward.name}`,
        });
        const balance = await applyGuardedBalanceDelta(
          tx,
          input.customerId,
          input.storeId,
          -reward.pointsCost,
        );
        await tx.insert(auditLogEntries).values({
          actorId: input.staffId,
          action: 'points.redeem',
          storeId: input.storeId,
          targetType: 'customer',
          targetId: input.customerId,
          after: {
            rewardId: reward.id,
            rewardName: reward.name,
            pointsCost: -reward.pointsCost,
            balance,
          },
        });
        return {
          redeemed: {
            rewardId: reward.id,
            name: reward.name,
            pointsCost: -reward.pointsCost,
          } satisfies RedeemedReward,
          balance,
        };
      };

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
          discountCents,
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

          const visitRedemption = await redeemWith(saleId);

          return {
            entryId: visitRow.id,
            saleId,
            points: 0,
            awarded: false,
            reason: calculation.reason,
            replayed: false,
            redeemed: visitRedemption.redeemed,
            discountCents,
          };
        }

        // A below-minimum purchase can still pay for a reward: the coffee
        // is bought with points saved earlier, not with this sale's points.
        const redemption = await redeemWith(saleId);

        return {
          entryId: null,
          saleId,
          points: 0,
          awarded: false,
          reason: calculation.reason,
          replayed: false,
          redeemed: redemption.redeemed,
          discountCents,
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

      const redemption = await redeemWith(saleId);

      return {
        entryId: inserted[0]?.id ?? null,
        saleId,
        points: calculation.points,
        awarded: true,
        replayed: false,
        breakdown: calculation.breakdown ?? [],
        redeemed: redemption.redeemed,
        discountCents,
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
        saleDiscountCents: sales.discountCents,
      })
      .from(pointsLedgerEntries)
      .leftJoin(sales, eq(sales.id, pointsLedgerEntries.saleId))
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

    // The receipt a replay still owes its caller (D-138), rebuilt from
    // the ledger outside any transaction.
    const redeemRows =
      found.saleId === null
        ? []
        : await db
            .select({
              rewardId: pointsLedgerEntries.rewardId,
              points: pointsLedgerEntries.points,
              name: storeRewards.name,
            })
            .from(pointsLedgerEntries)
            .innerJoin(storeRewards, eq(storeRewards.id, pointsLedgerEntries.rewardId))
            .where(
              and(
                eq(pointsLedgerEntries.saleId, found.saleId),
                eq(pointsLedgerEntries.type, 'redeem'),
              ),
            )
            .limit(1);
    const redeemRow = redeemRows[0];

    return {
      entryId: found.id,
      saleId: found.saleId,
      points: found.points,
      awarded: true,
      replayed: true,
      discountCents: found.saleDiscountCents ?? 0,
      redeemed:
        redeemRow === undefined || redeemRow.rewardId === null
          ? null
          : { rewardId: redeemRow.rewardId, name: redeemRow.name, pointsCost: redeemRow.points },
    };
  }
}


export interface PreviewEarnInput {
  customerId: string;
  storeId: string;
  amountCents: number;
  /** What the customer will actually pay (D-129); the quote prices this. */
  amountPaidCents?: number;
  /** The reward the till offers with this quote (D-138). */
  redeemRewardId?: string;
  /** The rotating code to quote the discount against (D-133); a dry run. */
  discountProof?: string;
  /** The legacy single per-euro rule. */
  rule?: PointsRule;
  /** The store's earning program (WP2). */
  program?: AwardProgram;
  /** Set internally when a rule counts visits; callers never pass it. */
  visitNumber?: number;
  locationId: string | null;
}

/** The reward quote the till shows next to the points (D-138). */
export interface PreviewRedeemed {
  rewardId: string;
  name: string;
  pointsCost: number;
  affordable: boolean;
  limitReached: boolean;
}

export interface PreviewEarnResult {
  /** What the basket discount would take off (D-133), zero when none. */
  discountCents: number;
  points: number;
  awarded: boolean;
  reason?: PointsRejectionReason | undefined;
  /** UTC midnight of the expiry day, or null when nothing will be awarded. */
  expiresAt: Date | null;
  locationId: string | null;
  locationName: string | null;
  breakdown?: RuleBreakdownEntry[];
  /** The reward offered with this quote, or none. */
  redeemed: PreviewRedeemed | null;
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

  // D-138: the reward quote. The confirm enforces the rules; the quote only
  // says what will happen, so affordability is projected onto the balance
  // the award will leave behind.
  let redeemed: PreviewRedeemed | null = null;
  if (input.redeemRewardId !== undefined) {
    const rewardRows = await db
      .select({
        id: storeRewards.id,
        name: storeRewards.name,
        pointsCost: storeRewards.pointsCost,
        active: storeRewards.active,
        perCustomerPerDayLimit: storeRewards.perCustomerPerDayLimit,
      })
      .from(storeRewards)
      .where(and(eq(storeRewards.id, input.redeemRewardId), eq(storeRewards.storeId, input.storeId)))
      .limit(1);
    const reward = rewardRows[0];
    if (!reward) {
      throw new LedgerError('REWARD_NOT_FOUND', 'That reward does not exist at this store');
    }
    if (!reward.active) {
      throw new LedgerError('REWARD_NOT_ACTIVE', 'That reward is not offered any more');
    }
    const limitReached =
      reward.perCustomerPerDayLimit !== null &&
      (await rewardTakesToday(db, input.customerId, input.storeId, reward.id)) >=
        reward.perCustomerPerDayLimit;
    const balance = await getBalance(db, input.customerId, input.storeId);
    const projected = balance + (calculation.awarded ? calculation.points : 0);
    redeemed = {
      rewardId: reward.id,
      name: reward.name,
      pointsCost: reward.pointsCost,
      affordable: !limitReached && projected >= reward.pointsCost,
      limitReached,
    };
  }

  // D-133: quote the discount against the proof — a dry run, the code is
  // consumed only by the confirm.
  let discountCents = 0;
  if (input.discountProof !== undefined) {
    const check = checkDiscountProof(input.discountProof, {
      customerId: input.customerId,
      storeId: input.storeId,
    });
    if (!check.ok) throw proofError(check.reason);
    const ruleRows = await db
      .select({
        thresholdCents: discountRules.thresholdCents,
        kind: discountRules.kind,
        value: discountRules.value,
      })
      .from(discountRules)
      .where(and(eq(discountRules.storeId, input.storeId), eq(discountRules.active, true)))
      .limit(1);
    const rule = ruleRows[0];
    if (!rule) {
      throw new LedgerError('PROOF_INVALID', 'This store has no discount running');
    }
    const kind: DiscountKind = rule.kind === 'percent' ? 'percent' : 'fixed_cents';
    discountCents = discountFor(
      { thresholdCents: rule.thresholdCents, kind, value: rule.value },
      input.amountCents,
    );
    if (discountCents <= 0) {
      throw new LedgerError('PROOF_BELOW_THRESHOLD', 'This purchase is below the discount threshold');
    }
  }

  if (!calculation.awarded) {
    return {
      points: 0,
      awarded: false,
      reason: calculation.reason,
      expiresAt: null,
      locationId,
      locationName,
      breakdown: calculation.breakdown ?? [],
      redeemed,
      discountCents,
    };
  }

  return {
    points: calculation.points,
    awarded: true,
    expiresAt: expiryDateForEarn(new Date()),
    locationId,
    locationName,
    breakdown: calculation.breakdown ?? [],
    redeemed,
    discountCents,
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
    // Lock order (balance row, then batches) matches the redemption, so an
    // adjustment racing a redemption cannot deadlock.
    await lockCustomerBalance(tx, input.customerId, input.storeId);
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
    // Lock order (balance row, then batches) matches the redemption, so a
    // clawback racing a redemption cannot deadlock.
    await lockCustomerBalance(tx, input.customerId, input.storeId);
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
  /** The reversal of the sale's earn; null when the sale awarded nothing. */
  reversalEntryId: string | null;
  reversedPoints: number;
  /** What a full void gave back for rewards paid on this sale (D-143). */
  restoredPoints: number;
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
  // A reversal is a sensitive, audited action: it must say why (D-143).
  if (input.reason === undefined || input.reason.trim() === '') {
    throw new LedgerError('REASON_REQUIRED', 'A reversal needs a reason');
  }
  const reason = input.reason.trim();

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

    // Same lock order as every other balance-changing path: the balance
    // row first, batches after (see `lockCustomerBalance`).
    await lockCustomerBalance(tx, sale.customerId, input.storeId);
    const balanceBefore = await readBalance(tx, sale.customerId, input.storeId);

    // 1. A full void gives back what the sale's reward took (D-143) first.
    //    the customer cancelled the whole sale, so they should not lose the
    //    points they spent on it. Each redeem entry gets its own positive
    //    reversal naming it, and the returned points get a fresh batch with
    //    a fresh expiry, like a new award.
    const redeemRows = await tx
      .select({ id: pointsLedgerEntries.id, points: pointsLedgerEntries.points })
      .from(pointsLedgerEntries)
      .where(
        and(
          eq(pointsLedgerEntries.saleId, input.saleId),
          eq(pointsLedgerEntries.type, 'redeem'),
          sql`${pointsLedgerEntries.points} < 0`,
        ),
      );
    let restoredPoints = 0;
    const restoredBatches: { entryId: string; points: number }[] = [];
    for (const redeem of redeemRows) {
      const restored = -redeem.points;
      const insertedRestore = await tx
        .insert(pointsLedgerEntries)
        .values({
          customerId: sale.customerId,
          storeId: input.storeId,
          type: 'reversal',
          points: restored,
          reversalOf: redeem.id,
          saleId: input.saleId,
          staffId: input.staffId,
          reason,
        })
        .returning({ id: pointsLedgerEntries.id });
      const restoreEntryId = insertedRestore[0]?.id;
      if (restoreEntryId !== undefined) {
        restoredBatches.push({ entryId: restoreEntryId, points: restored });
      }
      await applyBalanceDelta(tx, sale.customerId, input.storeId, restored);
      restoredPoints += restored;
    }


    // 2. Take back what the sale's earn gave (when it gave anything).
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

    let reversalEntryId: string | null = null;
    let reversedPoints = 0;
    if (earn) {
      const points = -earn.points;
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
      reversalEntryId = inserted[0]?.id ?? null;
      reversedPoints = points;

      // The guarded delta refuses a reversal that would take the balance
      // below zero; the whole transaction then rolls back and the sale
      // stays completed.
      await applyGuardedBalanceDelta(tx, sale.customerId, input.storeId, points);
    }

    // The restored reward points become fresh batches only after the earn
    // has been drawn down, so the earn reversal cannot consume them.
    for (const restore of restoredBatches) {
      await createBatch(tx, {
        earnEntryId: restore.entryId,
        customerId: sale.customerId,
        storeId: input.storeId,
        originalPoints: restore.points,
        expiresAt: expiryDateForEarn(new Date()),
      });
    }

    await tx.update(sales).set({ status: 'reversed' }).where(eq(sales.id, input.saleId));

    const newBalance = await readBalance(tx, sale.customerId, input.storeId);

    await tx.insert(auditLogEntries).values({
      actorId: input.staffId,
      action: 'sale.reversal',
      storeId: input.storeId,
      targetType: 'sale',
      targetId: input.saleId,
      before: { balance: balanceBefore },
      after: { balance: newBalance, points: reversedPoints, restoredPoints },
      reason,
    });

    return { reversalEntryId, reversedPoints, restoredPoints, balance: newBalance };
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

/**
 * How a points result is rounded to a whole number.
 * `floor` is the default everywhere (FR-PTS-1).
 */
export type RoundingMode = 'floor' | 'nearest';

/**
 * Why an award was not made.
 * - `below_minimum`: the purchase was under the store's minimum purchase (FR-PTS-2).
 */
export type PointsRejectionReason = 'below_minimum';

/**
 * A store's earning rules.
 *
 * `pointsPerEuroThousandths` is an integer in thousandths, so 1000 means
 * "1 point per euro" and 1500 means "1.5 points per euro". Storing it this
 * way keeps every points calculation in integer maths: no floating point
 * ever touches money or points (AGENT.md section 6).
 */
export interface PointsRule {
  pointsPerEuroThousandths: number;
  minPurchaseCents?: number;
  maxPointsPerTransaction?: number;
  rounding?: RoundingMode;
}

/**
 * The outcome of calculating points for one purchase.
 *
 * `uncappedPoints` is the result before the per-transaction cap, so the
 * Cashier screen can tell the cashier that the award was capped (FR-PTS-3).
 */
export interface PointsCalculation {
  points: number;
  uncappedPoints: number;
  capped: boolean;
  awarded: boolean;
  reason?: PointsRejectionReason;
}

/**
 * The kinds of change a ledger entry can make to a balance.
 * The ledger is append-only; there is no `reverse` type (AGENT.md section 6).
 */
export type LedgerEntryType = 'earn' | 'redeem' | 'adjust' | 'expire' | 'fraud_clawback';

export interface LedgerEntry {
  type: LedgerEntryType;
  points: number;
}

/**
 * A batch of points that is still available to spend or that may still expire.
 */
export interface PointsBatch {
  entryId: string;
  points: number;
  remainingPoints: number;
  expiresAt?: Date;
}

/**
 * How much was taken from one batch.
 */
export interface ConsumedBatch {
  entryId: string;
  points: number;
}

export type PointsErrorCode =
  | 'BALANCE_WOULD_GO_NEGATIVE'
  | 'INSUFFICIENT_POINTS'
  | 'INVALID_AMOUNT';

export interface PointsError {
  code: PointsErrorCode;
  message: string;
}

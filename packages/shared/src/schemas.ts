import { z } from 'zod';

/**
 * Request and response schemas shared between the API and its clients
 * (AGENT.md section 10). The same schemas drive validation and the OpenAPI
 * document, so the two cannot drift apart.
 */

export const storeIdParamsSchema = z.object({
  storeId: z.string().uuid(),
});

export const customerParamsSchema = z.object({
  storeId: z.string().uuid(),
  customerId: z.string().uuid(),
});

/**
 * The largest purchase the API accepts, in cents.
 *
 * Two reasons for a cap. With no reversals (D-013) a mistyped amount is
 * permanent, so there is a sanity limit. And the points maths multiplies
 * the amount by the earn rate, so a huge amount would leave the range where
 * integers are exact.
 */
export const MAX_AMOUNT_CENTS = 100_000_000;

export const awardRequestSchema = z.object({
  customerId: z.string().uuid(),
  amountCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS),
  // WP3, D-129: what the customer actually paid. Points are calculated on
  // this; it may never exceed the charged amount. Defaults to the charge.
  amountPaidCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS).optional(),
  // The store's own till or POS receipt reference, when it has one (WP3).
  posReference: z.string().trim().max(120).optional(),
  // D-138: spend a catalog reward's points in the same confirm. The whole
  // confirm is one atomic action under one idempotency key.
  redeemRewardId: z.string().uuid().optional(),
  // D-133: the customer's rotating discount code. The confirm consumes it —
  // one code, one sale — and records the discount on the sale.
  discountProof: z.string().trim().min(1).max(400).optional(),
  // D-103: which branch the purchase was at. Optional, because many stores
  // have none, and a member limited to one branch does not need to send it.
  locationId: z.string().uuid().optional(),
});

export const credentialTypeSchema = z.enum(['app_qr', 'nfc_card', 'wallet_pass']);

export const identifyRequestSchema = z.object({
  credentialIdentifier: z.string().min(1).max(200),
  // The identifier is only unique per type, so the type has to travel with it.
  credentialType: credentialTypeSchema.default('app_qr'),
});

export const idempotencyKeyHeaderSchema = z.object({
  'idempotency-key': z.string().min(1).max(200),
});

export const pointsBreakdownEntrySchema = z.object({
  ruleId: z.string().uuid().optional(),
  type: z.enum(['per_euro', 'fixed_per_purchase', 'threshold_bonus', 'every_nth_visit']),
  version: z.number().int(),
  points: z.number().int(),
  applied: z.boolean(),
  reason: z.enum(['below_minimum', 'condition_not_met']).optional(),
});

export const awardResponseSchema = z.object({
  entryId: z.string().uuid().nullable(),
  /** The sale this confirm recorded (WP3, D-118). */
  saleId: z.string().uuid().nullable(),
  /** The reward paid for in this confirm, or none (D-138). */
  redeemed: z
    .object({
      rewardId: z.string().uuid(),
      name: z.string(),
      pointsCost: z.number().int().max(0),
    })
    .nullable(),
  /** What the basket discount took off this sale (D-133), or zero. */
  discountCents: z.number().int().min(0).nullable(),
  points: z.number().int(),
  awarded: z.boolean(),
  reason: z.string().optional(),
  /** Which rules produced the award (FR-CHK-5). */
  breakdown: z.array(pointsBreakdownEntrySchema).optional(),
});

/**
 * The till's "recent awards" list (FR-STO-9): the calling cashier's own
 * latest earn entries at this store, newest first.
 */
export const recentAwardsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const recentAwardEntrySchema = z.object({
  entryId: z.string().uuid(),
  customerName: z.string(),
  points: z.number().int(),
  amountCents: z.number().int().nullable(),
  /** The rules that produced it, exactly as the ledger froze them. */
  breakdown: z.array(pointsBreakdownEntrySchema).nullable(),
  createdAt: z.string(),
});

export const recentAwardsResponseSchema = z.object({
  entries: z.array(recentAwardEntrySchema),
});

/** Reversing a sale (WP3, D-131): the till undoes one confirmed award. */
export const saleIdParamsSchema = storeIdParamsSchema.extend({
  saleId: z.string().uuid(),
});

export const reversalRequestSchema = z.object({
  /** Why the sale is being undone — required, and it lands in the audit log. */
  reason: z.string().trim().min(1).max(500),
});

export const reversalResponseSchema = z.object({
  /** The reversal of the sale's earn; null when the sale awarded nothing. */
  reversalEntryId: z.string().uuid().nullable(),
  /** What the sale's earn gave, taken back — always zero or below. */
  reversedPoints: z.number().int().max(0),
  /** What a full void gave back for rewards paid on this sale (D-143). */
  restoredPoints: z.number().int().min(0),
  balance: z.number().int(),
});

/* ── Rewards catalog and redemption (D-138) ────────────────────────────── */

/** A points cost in points; a reward may not be free, and not absurd. */
export const MAX_REWARD_POINTS_COST = 1_000_000;

export const storeRewardRowSchema = z.object({
  rewardId: z.string().uuid(),
  name: z.string(),
  pointsCost: z.number().int().min(1).max(MAX_REWARD_POINTS_COST),
  /** null means no per-customer daily cap. */
  perCustomerPerDayLimit: z.number().int().min(1).max(1000).nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});

export const storeRewardsResponseSchema = z.object({
  rewards: z.array(storeRewardRowSchema),
});

export const rewardCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  pointsCost: z.number().int().min(1).max(MAX_REWARD_POINTS_COST),
  perCustomerPerDayLimit: z.number().int().min(1).max(1000).nullish(),
});

export const rewardEditRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    pointsCost: z.number().int().min(1).max(MAX_REWARD_POINTS_COST).optional(),
    perCustomerPerDayLimit: z.number().int().min(1).max(1000).nullish(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Change at least one field',
  });

export const rewardParamsSchema = storeIdParamsSchema.extend({
  rewardId: z.string().uuid(),
});

/** The till's picker: what this customer can take right now (D-138). */
export const tillRewardsQuerySchema = z.object({
  customerId: z.string().uuid(),
  /** What this purchase will actually be paid as, so the picker counts the
   * points the purchase itself will earn (D-145): a customer with zero
   * points can still take a reward their new purchase covers. */
  paidCents: z.coerce.number().int().min(0).max(MAX_AMOUNT_CENTS).optional(),
});

export const tillRewardSchema = z.object({
  rewardId: z.string().uuid(),
  name: z.string(),
  pointsCost: z.number().int().min(1).max(MAX_REWARD_POINTS_COST),
  affordable: z.boolean(),
  redeemedToday: z.number().int().min(0),
  limitReached: z.boolean(),
});

export const tillRewardsResponseSchema = z.object({
  balance: z.number().int(),
  rewards: z.array(tillRewardSchema),
});

/** The customer app's read-only view of a store's catalog. */
export const customerStoreRewardsResponseSchema = z.object({
  rewards: z.array(
    z.object({
      rewardId: z.string().uuid(),
      name: z.string(),
      pointsCost: z.number().int().min(1).max(MAX_REWARD_POINTS_COST),
    }),
  ),
});

/* ── The basket discount behind the rotating QR (D-115, D-133) ─────────── */

export const discountRuleRowSchema = z.object({
  discountRuleId: z.string().uuid(),
  thresholdCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS),
  kind: z.enum(['fixed_cents', 'percent']),
  /** fixed_cents: cents off. percent: thousandths of a percent, 100_000 = 100%. */
  value: z.number().int().min(1).max(100_000_000),
  active: z.boolean(),
  createdAt: z.string(),
});

export const discountRuleResponseSchema = z.object({
  rule: discountRuleRowSchema.nullable(),
});

export const discountRuleSetRequestSchema = z.object({
  thresholdCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS),
  kind: z.enum(['fixed_cents', 'percent']),
  value: z.number().int().min(1).max(100_000_000),
  active: z.boolean().default(true),
});

/** The customer's rotating code, fresh from the API (D-133). */
export const discountProofIssueResponseSchema = z.object({
  proof: z.string().min(1),
  /** UTC instant after which the till will refuse the code. */
  expiresAt: z.string(),
  /** False when the store has no discount running — the app hides the code. */
  active: z.boolean(),
});

export const discountProofVerifyRequestSchema = z.object({
  proof: z.string().trim().min(1).max(400),
  amountCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS),
  /** The customer the till is serving; the code must be theirs. */
  customerId: z.string().uuid().optional(),
});

export const discountProofVerifyResponseSchema = z.object({
  valid: z.boolean(),
  /** When not valid: 'invalid' | 'expired' | 'used' | 'below_threshold' | 'no_rule'. */
  reason: z.string().optional(),
  /** What the discount would take off — zero when not valid. */
  discountCents: z.number().int().min(0),
});

/* ── The owner's remaining panels: profile, branches, customer detail, reports ── */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour looks like #0b7a4b');

export const storeProfileResponseSchema = z.object({
  name: z.string(),
  address: z.string().nullable(),
  /** Business niche (D-168), e.g. restaurant, cafe, shop. */
  category: z.string().nullable(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  brandColor: z.string().nullable(),
  /** Supabase Storage public URL, or null when the store has no logo. */
  logoUrl: z.string().nullable(),
});

/** A logo upload: a base64 image, already checked by the browser for size. */
export const storeLogoUpdateRequestSchema = z.object({
  contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  // 2 MB decoded is about 2.8 M base64 characters; the API checks the bytes
  // again after decoding.
  data: z.string().min(16).max(2_900_000),
});

export const storeProfileUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    address: z.string().trim().max(200).nullish(),
    category: z.string().trim().max(60).nullish(),
    contactName: z.string().trim().max(120).nullish(),
    contactEmail: z.string().trim().max(200).nullish(),
    brandColor: hexColor.nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Change at least one field' });

export const branchRowSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string(),
  status: z.string(),
});

export const branchesResponseSchema = z.object({
  branches: z.array(branchRowSchema),
});

export const branchCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

/** One entry in a customer's history, as the owner's panel reads it. */
export const storeCustomerHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  points: z.number().int(),
  amountCents: z.number().int().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});

export const storeCustomerHistoryResponseSchema = z.object({
  balance: z.number().int(),
  entries: z.array(storeCustomerHistoryEntrySchema),
});

/** One day of the store's last thirty, for the overview chart (Helsinki days). */
export const storeReportsSeriesPointSchema = z.object({
  /** `YYYY-MM-DD`, in Europe/Helsinki. */
  date: z.string(),
  issued: z.number().int(),
  redeemed: z.number().int(),
  visits: z.number().int(),
});

export const storeReportsResponseSchema = z.object({
  customers: z.number().int(),
  newCustomers30d: z.number().int(),
  pointsIssued30d: z.number().int(),
  pointsRedeemed30d: z.number().int(),
  pointsExpired30d: z.number().int(),
  visits30d: z.number().int(),
  /** The last thirty days, oldest first, including days with no trade. */
  series: z.array(storeReportsSeriesPointSchema),
});

export const identifyResponseSchema = z.object({
  customerId: z.string().uuid(),
  firstName: z.string(),
  balance: z.number().int(),
});

export const balanceResponseSchema = z.object({
  customerId: z.string().uuid(),
  storeId: z.string().uuid(),
  balance: z.number().int(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

/**
 * The points rule an admin names when creating a store. The bounds mirror
 * the database CHECKs (`points_rules_rate_check` keeps the earn rate between
 * 0 exclusive and 1,000,000 inclusive, D-093).
 */
export const createStorePointsRuleSchema = z.object({
  pointsPerEuroThousandths: z.number().int().min(1).max(1_000_000),
  rounding: z.enum(['floor', 'nearest']).default('floor'),
  minPurchaseCents: z.number().int().min(0).optional(),
  maxPointsPerTransaction: z.number().int().min(0).optional(),
});

export const createStoreBranchSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().min(1).max(400).optional(),
});

/**
 * The store's first owner. An owner must already exist in the identity
 * provider (D-099): creation links the account, it does not sign anybody up.
 */
export const createStoreOwnerSchema = z.object({
  email: z.string().max(200),
  name: z.string().min(1).max(200),
  authUserId: z.string().uuid(),
});

export const createStoreRequestSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().min(1).max(400).optional(),
  contactName: z.string().min(1).max(200).optional(),
  contactEmail: z.string().max(200).optional(),
  pointsRule: createStorePointsRuleSchema,
  // Most stores have no branches and send nothing here (D-103).
  branches: z.array(createStoreBranchSchema).max(50).optional(),
  owner: createStoreOwnerSchema,
});

export const createdStoreRuleSchema = z.object({
  ruleVersion: z.number().int(),
  pointsPerEuroThousandths: z.number().int(),
  rounding: z.enum(['floor', 'nearest']),
  minPurchaseCents: z.number().int().optional(),
  maxPointsPerTransaction: z.number().int().optional(),
});

export const createdStoreBranchSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

export const createdStoreOwnerSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  locationId: z.string().uuid().nullable(),
});

export const createdStoreResponseSchema = z.object({
  storeId: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  rule: createdStoreRuleSchema,
  branches: z.array(createdStoreBranchSchema),
  owner: createdStoreOwnerSchema,
});

/**
 * An invitation by an owner (or the admin) or a cashier-only one by a
 * manager (FRD section 2). Ownership is never handed out by an invite:
 * changing who owns a store is a separate, reviewed action.
 */
export const inviteStaffRequestSchema = z.object({
  email: z.string().max(200),
  name: z.string().min(1).max(200),
  authUserId: z.string().uuid(),
  role: z.enum(['manager', 'cashier']),
  // D-103: when named, the member is limited to that branch of this store.
  locationId: z.string().uuid().optional(),
});

export const invitedStaffResponseSchema = z.object({
  memberId: z.string().uuid(),
  storeId: z.string().uuid(),
  role: z.enum(['manager', 'cashier']),
  locationId: z.string().uuid().nullable(),
  status: z.string(),
});

/** Who works at the store, for the owner portal's people page. */
export const storeStaffMemberSchema = z.object({
  memberId: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  role: z.string(),
  status: z.string(),
  locationName: z.string().nullable(),
});

export const storeStaffResponseSchema = z.object({
  members: z.array(storeStaffMemberSchema),
});

/**
 * Who the caller is, and the stores they work at. The Cashier screen calls
 * this before it knows which store it is selling for; a POS integration can
 * discover the same thing.
 */
export const meStaffSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  isAdmin: z.boolean(),
});

export const meBranchSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

export const meMembershipSchema = z.object({
  storeId: z.string().uuid(),
  storeName: z.string(),
  role: z.enum(['owner', 'manager', 'cashier']),
  /** The one branch this member is limited to, or null for every branch (D-103). */
  locationId: z.string().uuid().nullable(),
  locationName: z.string().nullable(),
  status: z.string(),
  /** The store's active branches, so a till can pick the right one (D-103). */
  branches: z.array(meBranchSchema),
});

export const meResponseSchema = z.object({
  staff: meStaffSchema,
  memberships: z.array(meMembershipSchema),
});

/**
 * What an award would do, without doing it (the Cashier screen's confirm
 * step). A below-minimum purchase is a 200 with `awarded: false` and a
 * `reason`: it is a normal till moment, not a failure (FR-PTS-2).
 */
export const awardPreviewResponseSchema = z.object({
  customerId: z.string().uuid(),
  points: z.number().int(),
  awarded: z.boolean(),
  reason: z.string().optional(),
  /** UTC date, for example 2027-01-22, or null when nothing will be awarded. */
  expiresAt: z.string().nullable(),
  locationId: z.string().uuid().nullable(),
  locationName: z.string().nullable(),
  /** Which rules produced the quoted points (FR-CHK-5). */
  breakdown: z.array(pointsBreakdownEntrySchema).optional(),
  /** What the basket discount would take off (D-133), when a proof was quoted. */
  discountCents: z.number().int().min(0).nullable().optional(),
  /** The reward the till offered with this quote, and whether the confirm will accept it (D-138). */
  redeemed: z
    .object({
      rewardId: z.string().uuid(),
      name: z.string(),
      /** What the reward costs, in points — positive here; the award response reports what was taken. */
      pointsCost: z.number().int().min(1).max(MAX_REWARD_POINTS_COST),
      affordable: z.boolean(),
      limitReached: z.boolean(),
    })
    .nullable()
    .optional(),
});

export const healthResponseSchema = z.object({
  status: z.string(),
  version: z.string(),
});

/**
 * The customer's own profile (D-111). `language` is stored now; the Finnish
 * and English strings arrive with the design pass.
 */
export const customerProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  language: z.string(),
  /** Global in-app notification preference; per-store consent stays separate. */
  notificationsEnabled: z.boolean(),
  createdAt: z.string(),
});

export const customerCredentialSchema = z.object({
  type: z.literal('app_qr'),
  identifier: z.string(),
});

export const customerMeResponseSchema = z.object({
  customer: customerProfileSchema,
  credential: customerCredentialSchema,
  onboardingComplete: z.boolean(),
});

/**
 * A partial profile update. Both fields are optional, but sending neither is
 * a mistake rather than a no-op.
 */
export const updateCustomerRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    language: z.enum(['fi', 'en']).optional(),
    notificationsEnabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.language !== undefined ||
      value.notificationsEnabled !== undefined,
    { message: 'Send a name, a language, or a notification preference' },
  );

export const customerStoreSchema = z.object({
  storeId: z.string().uuid(),
  name: z.string(),
  balance: z.number().int(),
  lastActivityAt: z.string(),
  /** The store's brand colour, so the app can paint its card (D-139). Null = OmaPointii green. */
  brandColor: z.string().nullable(),
  /** The owner's uploaded logo, or null for initials. */
  logoUrl: z.string().nullable(),
  /** Whether this customer accepts store news in the app (FR-PRV-2). */
  marketingConsent: z.boolean(),
  /** The cheapest active reward above the balance, or the best one to work toward. */
  nextReward: z
    .object({ name: z.string(), pointsCost: z.number().int() })
    .nullable(),
});

export const customerStoresResponseSchema = z.object({
  stores: z.array(customerStoreSchema),
});

export const customerHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  type: z.string(),
  points: z.number().int(),
  balanceAfter: z.number().int(),
});

export const customerHistoryResponseSchema = z.object({
  storeName: z.string(),
  balance: z.number().int(),
  entries: z.array(customerHistoryEntrySchema),
});

export const customerExpiringItemSchema = z.object({
  storeId: z.string().uuid(),
  storeName: z.string(),
  points: z.number().int(),
  expiresAt: z.string(),
});

export const customerExpiringResponseSchema = z.object({
  windowDays: z.number().int(),
  items: z.array(customerExpiringItemSchema),
});

/** FR-CUS-8 proposes a 14-day reminder window; a caller may ask for another. */
export const customerExpiringQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(14),
});

/**
 * Registering a customer at the till (FRD 4.4). The email is normalised, so
 * A@Shop.com and a@shop.com register the same person.
 */
export const registerCustomerRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .max(200)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'That is not an email address')
    .transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(100).optional(),
});

export const registeredCustomerSchema = z.object({
  customerId: z.string().uuid(),
  firstName: z.string(),
  email: z.string(),
  balance: z.number().int(),
  pending: z.boolean(),
});

export const storeCustomerSchema = z.object({
  customerId: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  balance: z.number().int(),
  pending: z.boolean(),
  joinedAt: z.string(),
});

export const storeCustomersResponseSchema = z.object({
  customers: z.array(storeCustomerSchema),
});

export const storeCustomersQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
});

/** A manual adjustment by an owner or manager (FRD 4.5). */
export const adjustmentRequestSchema = z.object({
  points: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0, { message: 'Points cannot be zero' }),
  reason: z.string().trim().min(3).max(500),
});

export const adjustmentResponseSchema = z.object({
  entryId: z.string().uuid().nullable(),
  balance: z.number().int(),
});

/** An admin fraud clawback (FRD 4.6): points to remove and the case note. */
export const clawbackRequestSchema = z.object({
  points: z.number().int().min(1).max(1_000_000),
  caseNote: z.string().trim().min(3).max(1000),
});

export const auditEntrySchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  actorEmail: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().uuid().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});

export const auditResponseSchema = z.object({
  entries: z.array(auditEntrySchema),
});

export const auditQuerySchema = z.object({
  action: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminAuditQuerySchema = auditQuerySchema.extend({
  storeId: z.string().uuid().optional(),
});

/**
 * What an owner (or manager) sends when they create or change a rule (WP2).
 * The bounds mirror the engine's technical limits, which hold the real
 * authority: the API refuses shape violations here and rule violations in
 * the engine (D-116: the platform owns the technical limits).
 */
export const earningRuleDefinitionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('per_euro'),
    pointsPerEuroThousandths: z.number().int().min(1).max(1_000_000),
    rounding: z.enum(['floor', 'nearest']).default('floor'),
    minSpendCents: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal('fixed_per_purchase'),
    points: z.number().int().min(1).max(1_000_000),
    minSpendCents: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal('threshold_bonus'),
    points: z.number().int().min(1).max(1_000_000),
    // Optional here: a threshold bonus without a threshold is refused by the
    // engine as an INVALID_RULE response, which carries its message.
    minSpendCents: z.number().int().min(1).optional(),
  }),
  z.object({
    type: z.literal('every_nth_visit'),
    points: z.number().int().min(1).max(1_000_000),
    everyN: z.number().int().min(2).max(1_000),
  }),
]);

export const earningRuleParamsSchema = storeIdParamsSchema.extend({
  ruleId: z.string().uuid(),
});

export const earningRuleRowSchema = z.object({
  ruleId: z.string().uuid(),
  ruleKey: z.string().uuid(),
  definition: earningRuleDefinitionSchema,
  version: z.number().int(),
  status: z.enum(['active', 'paused', 'superseded']),
  effectiveFrom: z.string(),
  createdAt: z.string(),
});

export const earningRulesResponseSchema = z.object({
  rules: z.array(earningRuleRowSchema),
});

export const earningRuleCreateRequestSchema = z.object({
  definition: earningRuleDefinitionSchema,
  /** Defaults to now; a future date schedules the rule to take effect. */
  effectiveFrom: z.string().datetime().optional(),
});

export const earningRuleEditRequestSchema = earningRuleCreateRequestSchema;

export const earningRuleStatusRequestSchema = z.object({
  status: z.enum(['active', 'paused']),
});

/** A dry-run of the engine against a draft or the store's current rules. */
export const ruleSimulateRequestSchema = z.object({
  amountCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS),
  /** Which visit to assume for every_nth_visit rules; defaults to the first. */
  visitNumber: z.number().int().min(1).max(10_000).optional(),
  /** Rules to try. When absent, the store's current rule set is used. */
  rules: z.array(earningRuleDefinitionSchema).max(20).optional(),
});

export const ruleSimulateResponseSchema = z.object({
  points: z.number().int(),
  uncappedPoints: z.number().int(),
  capped: z.boolean(),
  awarded: z.boolean(),
  reason: z.string().optional(),
  breakdown: z.array(pointsBreakdownEntrySchema),
  rulesSource: z.enum(['store', 'draft']),
});

/* ── Campaigns and in-app notifications (D-148) ─────────────────────────── */

/**
 * A store's message to its customers. Short on purpose: one title and one
 * paragraph, the shape of a phone notification. Email and SMS are not
 * offered until a sender exists.
 */
export const campaignCreateRequestSchema = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(300),
});

export const campaignRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  status: z.string(),
  /** How many customers the message was delivered to. */
  recipients: z.number().int(),
  /** How many of those opened it in the app. */
  opened: z.number().int(),
  createdAt: z.string(),
});

export const campaignsResponseSchema = z.object({
  campaigns: z.array(campaignRowSchema),
});

/** Who a campaign would reach, before it is sent. */
export const campaignAudienceSchema = z.object({
  /** Customers linked to this store. */
  linked: z.number().int(),
  /** Of those, the ones who accept store news in the app (FR-PRV-2). */
  optedIn: z.number().int(),
});

/** One campaign as the customer's inbox reads it. */
export const customerNotificationSchema = z.object({
  id: z.string().uuid(),
  storeId: z.string().uuid(),
  storeName: z.string(),
  storeBrandColor: z.string().nullable(),
  storeLogoUrl: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});

export const customerNotificationsResponseSchema = z.object({
  unread: z.number().int(),
  notifications: z.array(customerNotificationSchema),
});

export const customerNotificationParamsSchema = z.object({
  notificationId: z.string().uuid(),
});

export const notificationReadResponseSchema = z.object({
  id: z.string().uuid(),
  readAt: z.string(),
});

/** The customer's answer to "may this store send me news in the app?". */
export const storeConsentRequestSchema = z.object({
  marketingConsent: z.boolean(),
});

export const storeConsentResponseSchema = z.object({
  storeId: z.string().uuid(),
  marketingConsent: z.boolean(),
});

/* ── Platform admin console (brief §4.3) ────────────────────────────────── */

export const adminStoreRowSchema = z.object({
  storeId: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  plan: z.string().nullable(),
  customers: z.number().int(),
  /** Last ledger entry at this store, or null before the first award. */
  lastActivityAt: z.string().nullable(),
  createdAt: z.string(),
});

export const adminStoresResponseSchema = z.object({
  stores: z.array(adminStoreRowSchema),
});

export const adminStoresQuerySchema = z.object({
  status: z.enum(['active', 'paused', 'suspended', 'invited', 'setup', 'offboarded']).optional(),
  query: z.string().trim().max(120).optional(),
});

export const adminStoreStaffSchema = z.object({
  memberId: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.string(),
  locationName: z.string().nullable(),
});

export const adminStoreDetailSchema = z.object({
  store: z.object({
    storeId: z.string().uuid(),
    name: z.string(),
    status: z.string(),
    plan: z.string().nullable(),
    address: z.string().nullable(),
    contactName: z.string().nullable(),
    contactEmail: z.string().nullable(),
    brandColor: z.string().nullable(),
    logoUrl: z.string().nullable(),
    maxPointsPerSale: z.number().int().nullable(),
    createdAt: z.string(),
  }),
  subscription: z
    .object({
      plan: z.string(),
      status: z.string(),
      currentPeriodEnd: z.string().nullable(),
    })
    .nullable(),
  counts: z.object({
    customers: z.number().int(),
    staff: z.number().int(),
    activeRules: z.number().int(),
    activeRewards: z.number().int(),
    branches: z.number().int(),
    awards30d: z.number().int(),
    redemptions30d: z.number().int(),
    /** The sum of every customer's balance at this store. */
    outstandingPoints: z.number().int(),
  }),
  /** The onboarding readiness card: what a working store has. */
  readiness: z.object({
    owner: z.boolean(),
    rule: z.boolean(),
    reward: z.boolean(),
    cashier: z.boolean(),
  }),
  staff: z.array(adminStoreStaffSchema),
  recent: z.array(auditEntrySchema),
});

export const adminStoreStatusRequestSchema = z.object({
  status: z.enum(['active', 'paused', 'suspended']),
  /** Why the store's access changes; lands in the audit log. */
  reason: z.string().trim().min(3).max(500),
});

export const adminStoreStatusResponseSchema = z.object({
  storeId: z.string().uuid(),
  status: z.string(),
});

export const adminSupportQuerySchema = z.object({
  query: z.string().trim().min(2).max(200),
});

export const adminSupportResponseSchema = z.object({
  stores: z.array(
    z.object({
      storeId: z.string().uuid(),
      name: z.string(),
      status: z.string(),
    }),
  ),
  customers: z.array(
    z.object({
      customerId: z.string().uuid(),
      email: z.string(),
      name: z.string(),
      createdAt: z.string(),
      balances: z.array(
        z.object({
          storeId: z.string().uuid(),
          storeName: z.string(),
          balance: z.number().int(),
        }),
      ),
    }),
  ),
});

export const adminAnalyticsResponseSchema = z.object({
  stores: z.number().int(),
  activeStores: z.number().int(),
  customers: z.number().int(),
  awards30d: z.number().int(),
  redemptions30d: z.number().int(),
  outstandingPoints: z.number().int(),
});

export const adminSubscriptionRowSchema = z.object({
  storeId: z.string().uuid(),
  storeName: z.string(),
  plan: z.string(),
  status: z.string(),
  currentPeriodEnd: z.string().nullable(),
  firstFailedPaymentAt: z.string().nullable(),
});

export const adminSubscriptionsResponseSchema = z.object({
  subscriptions: z.array(adminSubscriptionRowSchema),
});

/* ── Customer app: the store directory (D-157) ──────────────────────────── */

export const directoryQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
});

export const directoryStoreSchema = z.object({
  storeId: z.string().uuid(),
  name: z.string(),
  address: z.string().nullable(),
  category: z.string().nullable(),
  brandColor: z.string().nullable(),
  logoUrl: z.string().nullable(),
  /** True when this customer already has a link or a balance at the store. */
  visited: z.boolean(),
  balance: z.number().int(),
  /** Completed earns at this store for this customer. */
  visitCount: z.number().int(),
  distanceKm: z.number().min(0).nullable().optional(),
});

export const directoryResponseSchema = z.object({
  stores: z.array(directoryStoreSchema),
});

/* ── Customer app: unregistered nearby places (OpenStreetMap, D-169) ─────── */

export const discoverQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(1).max(20).default(10),
});

export const nearbyPlaceSchema = z.object({
  osmId: z.string(),
  name: z.string(),
  category: z.string(),
  address: z.string().nullable(),
  distanceKm: z.number().min(0),
  latitude: z.number(),
  longitude: z.number(),
  website: z.string().nullable(),
  phone: z.string().nullable(),
  openingHours: z.string().nullable(),
});

export const discoverResponseSchema = z.object({
  places: z.array(nearbyPlaceSchema),
  available: z.boolean(),
  attribution: z.string(),
  provider: z.string().optional(),
});

/* ── Owner portal: nearby business leads (D-170) ────────────────────────── */

export const leadCreateRequestSchema = z.object({
  osmId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().max(80).nullable(),
  address: z.string().trim().max(240).nullable(),
  website: z.string().trim().max(320).nullable(),
  phone: z.string().trim().max(80).nullable(),
  openingHours: z.string().trim().max(240).nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  distanceKm: z.number().min(0),
});

export const businessLeadSchema = z.object({
  leadId: z.string().uuid(),
  storeId: z.string().uuid(),
  osmId: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  address: z.string().nullable(),
  website: z.string().nullable(),
  phone: z.string().nullable(),
  openingHours: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  distanceKm: z.number().nullable(),
  status: z.string(),
  createdAt: z.string(),
});

export const leadsResponseSchema = z.object({
  leads: z.array(businessLeadSchema),
});

/* ── Customer app: store offers (active basket discounts) ────────────────── */

export const customerOfferSchema = z.object({
  storeId: z.string().uuid(),
  storeName: z.string(),
  brandColor: z.string().nullable(),
  logoUrl: z.string().nullable(),
  thresholdCents: z.number().int(),
  kind: z.enum(['fixed_cents', 'percent']),
  value: z.number().int(),
});

export const customerOffersResponseSchema = z.object({
  offers: z.array(customerOfferSchema),
});

/* ── Customer privacy: export and deletion (A5) ─────────────────────────── */

export const customerExportSchema = z.object({
  exportedAt: z.string(),
  profile: z.object({
    id: z.string().uuid(),
    email: z.string(),
    name: z.string(),
    phone: z.string().nullable(),
    language: z.string(),
    status: z.string(),
    createdAt: z.string(),
  }),
  consents: z.array(
    z.object({
      storeId: z.string().uuid(),
      storeName: z.string(),
      joinedAt: z.string(),
      marketingConsent: z.boolean(),
    }),
  ),
  credentials: z.array(
    z.object({
      type: z.string(),
      identifier: z.string(),
      status: z.string(),
      createdAt: z.string(),
    }),
  ),
  balances: z.array(
    z.object({
      storeId: z.string().uuid(),
      storeName: z.string(),
      points: z.number().int(),
    }),
  ),
  ledger: z.array(
    z.object({
      id: z.string().uuid(),
      storeId: z.string().uuid(),
      storeName: z.string(),
      type: z.string(),
      points: z.number().int(),
      amountCents: z.number().int().nullable(),
      reason: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

export const deleteCustomerRequestSchema = z.object({
  code: z.string().trim().min(6).max(10),
});

export const deleteCustomerResponseSchema = z.object({
  deleted: z.literal(true),
});

export const adminCustomerParamsSchema = z.object({
  customerId: z.string().uuid(),
});

export const adminAnonymiseCustomerRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  confirmation: z.literal('ANONYMISE'),
});

export const adminAnonymiseCustomerResponseSchema = z.object({
  customerId: z.string().uuid(),
  deleted: z.literal(true),
});

/* ── C8: fraud and abuse signals ────────────────────────────────────────── */

export const safetySignalKindSchema = z.enum([
  'awards_per_cashier_day',
  'redemptions_per_customer_30d',
  'reversals_per_staff_30d',
  'adjustments_per_staff_30d',
]);

export const safetySignalSchema = z.object({
  kind: safetySignalKindSchema,
  label: z.string(),
  subject: z.string(),
  count: z.number().int(),
  threshold: z.number().int(),
  window: z.string(),
});

export const adminSafetySignalsResponseSchema = z.object({
  thresholds: z.object({
    awardsPerCashierDay: z.number().int(),
    redemptionsPerCustomer30d: z.number().int(),
    reversalsPerStaff30d: z.number().int(),
    adjustmentsPerStaff30d: z.number().int(),
  }),
  signals: z.array(safetySignalSchema),
});


/* ── Feedback (customer, merchant, admin, till) ─────────────────────────── */

export const feedbackCategorySchema = z.enum(['bug', 'idea', 'other']);

export const feedbackRequestSchema = z.object({
  category: feedbackCategorySchema,
  message: z.string().trim().min(3).max(2000),
  page: z.string().trim().max(200).optional(),
});

export const feedbackResponseSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
});

export const adminFeedbackRowSchema = z.object({
  id: z.string().uuid(),
  source: z.string(),
  category: z.string(),
  message: z.string(),
  contactEmail: z.string().nullable(),
  page: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
});

export const adminFeedbackResponseSchema = z.object({
  feedback: z.array(adminFeedbackRowSchema),
});

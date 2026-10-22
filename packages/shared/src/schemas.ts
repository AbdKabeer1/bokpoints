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

export const awardResponseSchema = z.object({
  entryId: z.string().uuid().nullable(),
  points: z.number().int(),
  awarded: z.boolean(),
  reason: z.string().optional(),
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
  })
  .refine((value) => value.name !== undefined || value.language !== undefined, {
    message: 'Send a name, a language, or both',
  });

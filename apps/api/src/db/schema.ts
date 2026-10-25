import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The BOKPOINTS data model, from FRD section 3.
 *
 * Money is whole cents in euros and points are whole numbers, so every
 * money column is an integer named `*Cents` and every points column is an
 * integer. There is no floating point anywhere in the schema (AGENT.md
 * section 6).
 */

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    /**
     * The Supabase user behind this customer (D-111), the same link
     * `staff_users.auth_user_id` provides for staff. Null until the customer
     * signs in for the first time.
     */
    authUserId: uuid('auth_user_id'),
    name: text('name').notNull(),
    phone: text('phone'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    language: text('language').notNull().default('fi'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // FR-AUTH-3: email is unique per customer. Compared case-insensitively,
    // because A@shop.com and a@shop.com are the same person.
    uniqueIndex('customers_email_unique').on(sql`lower(${t.email})`),
    uniqueIndex('customers_auth_user_unique').on(t.authUserId),
    check('customers_status_check', sql`${t.status} in ('active', 'deleted')`),
  ],
).enableRLS();

export const staffUsers = pgTable(
  'staff_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    // FR-AUTH-2: staff and admins need multi-factor authentication.
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    // FRD section 2: admin accounts are separate from store accounts.
    isAdmin: boolean('is_admin').notNull().default(false),
    status: text('status').notNull().default('active'),
    // The member's id in Supabase Auth (D-099). Our own id stays separate, so
    // the auth provider can change without touching every foreign key. Null
    // until the account is linked; one Supabase user is one staff user.
    authUserId: uuid('auth_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('staff_users_email_unique').on(sql`lower(${t.email})`),
    uniqueIndex('staff_users_auth_user_unique').on(t.authUserId),
    check('staff_users_status_check', sql`${t.status} in ('active', 'deactivated')`),
  ],
).enableRLS();

export const stores = pgTable(
  'stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    businessId: text('business_id'),
    address: text('address'),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    vatId: text('vat_id'),
    // The brand colour the customer app paints this store's page with (D-139).
    // Null until the store picks one; the app then falls back to its own green.
    brandColor: text('brand_color'),
    // The store's logo in Supabase Storage (D-156). Owner-uploaded; null means
    // the customer app shows initials on the brand colour instead.
    logoUrl: text('logo_url'),
    // Store status lifecycle from FRD 4.1.
    status: text('status').notNull().default('invited'),
    plan: text('plan'),
    // The store's per-sale ceiling (WP2, FR-RUL-5). A technical safety limit
    // against a typo, not a business rule. Null means only the platform's
    // ceiling applies.
    maxPointsPerSale: integer('max_points_per_sale'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'stores_max_points_per_sale_check',
      sql`${t.maxPointsPerSale} is null or ${t.maxPointsPerSale} >= 0`,
    ),
    check(
      'stores_status_check',
      sql`${t.status} in ('invited', 'setup', 'active', 'paused', 'suspended', 'offboarded')`,
    ),
  ],
).enableRLS();

/**
 * A branch of a store (D-103).
 *
 * A store is the business: points, the points rule and the subscription all
 * belong to it. A branch is one of its places. Plenty of stores have only one
 * place and no rows here at all. Where branches exist, an award records
 * which one it happened at, and a staff member can be limited to one.
 */
export const storeLocations = pgTable(
  'store_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    name: text('name').notNull(),
    address: text('address'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('store_locations_store_name_unique').on(t.storeId, t.name),
    // Lets other tables point at (branch, store) together, so the database
    // itself refuses a branch that belongs to a different store.
    unique('store_locations_id_store_unique').on(t.id, t.storeId),
    check('store_locations_status_check', sql`${t.status} in ('active', 'closed')`),
    index('store_locations_store_idx').on(t.storeId),
  ],
).enableRLS();

export const storeMembers = pgTable(
  'store_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => staffUsers.id),
    role: text('role').notNull(),
    // Null means the member works across every branch (D-103). A value
    // limits them to that one branch.
    locationId: uuid('location_id'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('store_members_store_user_unique').on(t.storeId, t.userId),
    foreignKey({
      columns: [t.locationId, t.storeId],
      foreignColumns: [storeLocations.id, storeLocations.storeId],
      name: 'store_members_location_store_fk',
    }),
    check('store_members_role_check', sql`${t.role} in ('owner', 'manager', 'cashier')`),
    check('store_members_status_check', sql`${t.status} in ('active', 'deactivated')`),
    index('store_members_store_idx').on(t.storeId),
  ],
).enableRLS();

export const cashierDevices = pgTable(
  'cashier_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    registeredBy: uuid('registered_by').references(() => staffUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('cashier_devices_status_check', sql`${t.status} in ('active', 'revoked')`),
    index('cashier_devices_store_idx').on(t.storeId),
  ],
).enableRLS();

export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    // FR-CRD-3: every credential type resolves to the same customer id.
    type: text('type').notNull(),
    identifier: text('identifier').notNull(),
    devicePublicKey: text('device_public_key'),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('credentials_type_identifier_unique').on(t.type, t.identifier),
    // At most one live app QR per customer (D-111). Without this, two
    // simultaneous first sign-ins could mint two codes and the till would
    // accept one the app no longer shows.
    uniqueIndex('credentials_one_active_qr_per_customer')
      .on(t.customerId)
      .where(sql`${t.type} = 'app_qr' and ${t.status} = 'active'`),
    check('credentials_type_check', sql`${t.type} in ('app_qr', 'nfc_card', 'wallet_pass')`),
    check('credentials_status_check', sql`${t.status} in ('active', 'lost', 'revoked')`),
    index('credentials_customer_idx').on(t.customerId),
  ],
).enableRLS();

export const customerStoreLinks = pgTable(
  'customer_store_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    // FR-PRV-2: marketing consent is off by default, recorded per store.
    marketingConsent: boolean('marketing_consent').notNull().default(false),
    status: text('status').notNull().default('active'),
  },
  (t) => [
    uniqueIndex('customer_store_links_customer_store_unique').on(t.customerId, t.storeId),
    check(
      'customer_store_links_status_check',
      sql`${t.status} in ('active', 'under_fraud_review')`,
    ),
    index('customer_store_links_store_idx').on(t.storeId),
  ],
).enableRLS();

export const pointsRules = pgTable(
  'points_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    // FR-STO-5: a rule change applies to future purchases only.
    ruleVersion: integer('rule_version').notNull(),
    // D-093: bounded at 1,000,000 thousandths (1,000 points per euro, both
    // ints far beyond any real loyalty scheme) so that on the largest
    // purchase the API accepts (€1,000,000) the multiplication stays
    // exactly representable and the award stays inside the int4 points
    // column for any rate the CHECK allows.
    pointsPerEuroThousandths: integer('points_per_euro_thousandths').notNull(),
    minPurchaseCents: integer('min_purchase_cents'),
    maxPointsPerTransaction: integer('max_points_per_transaction'),
    rounding: text('rounding').notNull().default('floor'),
    activeFrom: timestamp('active_from', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('points_rules_store_version_unique').on(t.storeId, t.ruleVersion),
    check(
      'points_rules_rate_check',
      sql`${t.pointsPerEuroThousandths} > 0 and ${t.pointsPerEuroThousandths} <= 1000000`,
    ),
    check(
      'points_rules_min_purchase_check',
      sql`${t.minPurchaseCents} is null or ${t.minPurchaseCents} >= 0`,
    ),
    check(
      'points_rules_max_points_check',
      sql`${t.maxPointsPerTransaction} is null or ${t.maxPointsPerTransaction} >= 0`,
    ),
    check('points_rules_rounding_check', sql`${t.rounding} in ('floor', 'nearest')`),
    index('points_rules_store_idx').on(t.storeId),
  ],
).enableRLS();

/**
 * A store's own earning rules (D-115, D-116, Way Forward WP2).
 *
 * `points_rules` stays as the legacy per-euro record that existing ledger
 * entries point at; the migration that adds this table converts every
 * `points_rules` row into one `per_euro` rule here, so nothing is lost.
 *
 * A rule is versioned: an edit writes a new row with the next store-wide
 * version and marks the previous one `superseded`, because a change must
 * never alter points already earned (FR-RUL-4). Only `active` rules with an
 * `effective_from` in the past take part in an award.
 */
export const earningRules = pgTable(
  'earning_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    // Stable across versions of the same rule.
    ruleKey: uuid('rule_key').notNull().defaultRandom(),
    type: text('type').notNull(),
    /** per_euro: pointsPerEuroThousandths, rounding. Fixed: points. */
    params: jsonb('params').notNull(),
    /** minSpendCents, optional branch and date conditions. */
    conditions: jsonb('conditions').notNull().default(sql`'{}'::jsonb`),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('active'),
    version: integer('version').notNull(),
    createdBy: uuid('created_by').references(() => staffUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'earning_rules_type_check',
      sql`${t.type} in ('per_euro', 'fixed_per_purchase', 'threshold_bonus', 'every_nth_visit')`,
    ),
    check('earning_rules_status_check', sql`${t.status} in ('active', 'paused', 'superseded')`),
    check('earning_rules_version_check', sql`${t.version} >= 1`),
    uniqueIndex('earning_rules_store_version_unique').on(t.storeId, t.version),
    index('earning_rules_store_status_idx').on(t.storeId, t.status, t.effectiveFrom),
  ],
).enableRLS();

/**
 * The sale record (WP3, D-118): one confirmed payment at the till.
 *
 * Points are calculated on `amountPaidCents` — what the customer actually
 * paid (D-129). `amountBeforeDiscountCents` keeps what the register
 * charged, and `discountCents` is the store-granted reduction, which stays
 * zero until the basket discount ships behind the rotating-QR gate
 * (D-115, D-133). Every award links to its sale; a reversal links to the
 * same one through the ledger entry's `reversal_of` (D-131).
 */
/**
 * The rewards catalog (D-138, moved into the MVP): what a customer can
 * spend points on, in the store's own words. The reward's name is what
 * the cashier hands over — a free coffee, a discount on the next visit —
 * and the points cost is what the ledger takes off, oldest-first.
 */
export const storeRewards = pgTable(
  'store_rewards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    name: text('name').notNull(),
    pointsCost: integer('points_cost').notNull(),
    /** null means no per-day cap; a customer cannot take the same reward twice in one day when set. */
    perCustomerPerDayLimit: integer('per_customer_per_day_limit'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('store_rewards_store_idx').on(t.storeId)],
).enableRLS();

/**
 * The store's basket discount (D-115, D-131): one per store — a basket
 * threshold with a fixed amount or a percent off. The store funds it in
 * its own till (D-130); Poket only quotes it, gated behind the customer's
 * rotating code (D-133). Editing changes the row in place; a paused rule
 * quotes nothing.
 */
export const discountRules = pgTable(
  'discount_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    /** The basket (before discount) must reach this to unlock the discount. */
    thresholdCents: integer('threshold_cents').notNull(),
    // fixed_cents | percent
    kind: text('kind').notNull(),
    /** For fixed_cents: the cents off. For percent: thousandths of a percent. */
    value: integer('value').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One discount per store (D-131): no stacking, ever.
    uniqueIndex('discount_rules_store_unique').on(t.storeId),
  ],
).enableRLS();

/**
 * A rotating discount proof, consumed (D-133): the code works once, and
 * this row is the receipt — which store's till took it, and for which
 * sale. The proof itself is signed and short-lived; this table only ever
 * grows by one row per used code.
 */
export const consumedDiscountProofs = pgTable(
  'consumed_discount_proofs',
  {
    /** The proof's jti — unique, so a replay of the same code is refused. */
    jti: uuid('jti').primaryKey(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    saleId: uuid('sale_id').references((): typeof sales.id => sales.id),
    consumedAt: timestamp('consumed_at', { withTimezone: true }).notNull().defaultNow(),
  },
).enableRLS();

export const sales = pgTable(
  'sales',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    locationId: uuid('location_id').references(() => storeLocations.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    staffId: uuid('staff_id').references(() => staffUsers.id),
    deviceId: uuid('device_id').references(() => cashierDevices.id),
    amountBeforeDiscountCents: integer('amount_before_discount_cents').notNull(),
    discountCents: integer('discount_cents').notNull().default(0),
    amountPaidCents: integer('amount_paid_cents').notNull(),
    /** The rules that produced the points, frozen at confirm time. */
    rulesApplied: jsonb('rules_applied'),
    /** The store's own till or POS receipt reference, when it has one. */
    posReference: text('pos_reference'),
    // completed | reversed.
    status: text('status').notNull().default('completed'),
    /** Ties the sale to the award's idempotency key, so a replay is one sale. */
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Same scope as the ledger's key (store, customer, request): the same
    // key under another customer is a different request, not a duplicate.
    uniqueIndex('sales_store_idempotency_unique')
      .on(t.storeId, t.customerId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index('sales_customer_store_idx').on(t.customerId, t.storeId),
    index('sales_created_idx').on(t.createdAt),
  ],
).enableRLS();

export const pointsLedgerEntries = pgTable(
  'points_ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    // earn, redeem (v1.1), adjust, expire, fraud_clawback.
    type: text('type').notNull(),
    points: integer('points').notNull(),
    amountCents: integer('amount_cents'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ruleVersion: integer('rule_version'),
    // Which rules produced this award, and how many points each gave
    // (FR-RUL-5, FR-CHK-5). A snapshot: later rule edits never rewrite it.
    rulesApplied: jsonb('rules_applied'),
    reason: text('reason'),
    staffId: uuid('staff_id').references(() => staffUsers.id),
    deviceId: uuid('device_id').references(() => cashierDevices.id),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    // Which branch an award happened at (D-103). Null for a store with no
    // branches, and for entries that are not tied to a place.
    locationId: uuid('location_id'),
    // WP3: every award belongs to a sale record (D-118). A visit-only
    // entry links to its sale too, so the sale history stays complete.
    saleId: uuid('sale_id').references(() => sales.id),
    // D-131: a POS reversal points at the entry it reverses. Reversals
    // happen once per sale; the sale's status says whether it happened.
    reversalOf: uuid('reversal_of'),
    // D-138: a redeem entry names the reward it paid for, so the per-day
    // limit can be counted and the receipt can be rebuilt on a replay.
    rewardId: uuid('reward_id').references(() => storeRewards.id),
    // FR-PTS-4: every award request carries an idempotency key.
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Direction per entry type. An `earn` always adds points. `redeem`,
    // `expire` and `fraud_clawback` only ever remove them. An `adjust` may
    // do either, and is kept at or above zero by the write path, which
    // refuses an adjustment that would take the balance below zero
    // (FR-PTS-8, FRD 4.5).
    check(
      'points_ledger_entries_points_sign',
      // A reversal undoes one entry, so it points either way: down when it
    // undoes an earn, up when a full void restores reward points (D-143).
    sql`(${t.type} = 'earn' and ${t.points} >= 0) or ${t.type} = 'adjust' or ${t.type} = 'reversal' or (${t.type} in ('redeem', 'expire', 'fraud_clawback') and ${t.points} <= 0)`,
    ),
    foreignKey({
      columns: [t.reversalOf],
      foreignColumns: [t.id],
      name: 'points_ledger_entries_reversal_of_fk',
    }),
    foreignKey({
      columns: [t.locationId, t.storeId],
      foreignColumns: [storeLocations.id, storeLocations.storeId],
      name: 'points_ledger_entries_location_store_fk',
    }),
    check(
      'points_ledger_entries_type_check',
      sql`${t.type} in ('earn', 'redeem', 'adjust', 'expire', 'fraud_clawback', 'reversal')`,
    ),
    // Scoped per store and per customer: a key identifies one award request.
    // A key reused for a different customer, or at a different store, is a
    // different request and must not be deduped against the first.
    uniqueIndex('points_ledger_entries_idempotency_unique')
      .on(t.storeId, t.customerId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index('points_ledger_entries_sale_idx').on(t.saleId),
    index('points_ledger_entries_reward_idx').on(t.rewardId, t.customerId, t.storeId),
    index('points_ledger_entries_customer_store_idx').on(t.customerId, t.storeId),
    index('points_ledger_entries_created_idx').on(t.createdAt),
  ],
).enableRLS();

/**
 * One batch of points, from one `earn` entry.
 *
 * The live counter lives here rather than on the ledger entry, because the
 * ledger is append-only: an entry is never edited or deleted (FRD section 3).
 * This table is the mutable part, the same kind of derived cache as
 * `points_balances`, and it records the expiry date and the remaining points
 * of a batch (FR-PTS-10).
 *
 * Points added by a manual adjustment have no batch, so they have no expiry
 * date and never expire. Only points that were earned expire.
 */
export const pointsBatches = pgTable(
  'points_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    earnEntryId: uuid('earn_entry_id')
      .notNull()
      .unique()
      .references(() => pointsLedgerEntries.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    originalPoints: integer('original_points').notNull(),
    remainingPoints: integer('remaining_points').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'points_batches_remaining_check',
      sql`${t.remainingPoints} >= 0 and ${t.remainingPoints} <= ${t.originalPoints}`,
    ),
    // The expiry job walks batches in this order.
    index('points_batches_expiry_idx').on(t.expiresAt),
    index('points_batches_customer_store_idx').on(t.customerId, t.storeId),
  ],
).enableRLS();

export const pointsBalances = pgTable(
  'points_balances',
  {
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    // Derived from the ledger and cached for speed. No CHECK on the balance:
    // an admin fraud clawback is allowed to take it below zero (FR-PTS-8).
    balance: integer('balance').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.storeId] })],
).enableRLS();

export const rejectedOfflineAwards = pgTable(
  'rejected_offline_awards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    deviceId: uuid('device_id').references(() => cashierDevices.id),
    customerId: uuid('customer_id').references(() => customers.id),
    amountCents: integer('amount_cents').notNull(),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull(),
    reason: text('reason').notNull(),
    reviewedBy: uuid('reviewed_by').references(() => staffUsers.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('rejected_offline_awards_store_idx').on(t.storeId)],
).enableRLS();

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    plan: text('plan').notNull(),
    status: text('status').notNull().default('active'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    // FR-BIL-4: the failed-payment schedule counts from the first failure.
    firstFailedPaymentAt: timestamp('first_failed_payment_at', { withTimezone: true }),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('subscriptions_store_unique').on(t.storeId),
    check(
      'subscriptions_status_check',
      sql`${t.status} in ('trialing', 'active', 'past_due', 'paused', 'suspended', 'canceled')`,
    ),
  ],
).enableRLS();

export const auditLogEntries = pgTable(
  'audit_log_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    storeId: uuid('store_id').references(() => stores.id),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_entries_store_idx').on(t.storeId),
    index('audit_log_entries_created_idx').on(t.createdAt),
  ],
).enableRLS();

/**
 * In-app campaigns (D-148). A store writes one short message and Poket
 * delivers it inside the customer app to every linked customer who has
 * opted in to store news. There is no email or SMS sender yet, so this is
 * the only channel; a delivery row is the customer's copy.
 */
export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    title: text('title').notNull(),
    body: text('body').notNull(),
    // Sending is immediate in this build; the value leaves room for a
    // scheduled state when a worker exists.
    status: text('status').notNull().default('sent'),
    // How many customers the message went to, kept so the list stays true
    // even after a customer leaves the store.
    recipients: integer('recipients').notNull().default(0),
    createdBy: uuid('created_by').references(() => staffUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('campaigns_store_idx').on(t.storeId, t.createdAt),
    check('campaigns_status_check', sql`${t.status} in ('sent')`),
  ],
).enableRLS();

export const campaignDeliveries = pgTable(
  'campaign_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('campaign_deliveries_unique').on(t.campaignId, t.customerId),
    index('campaign_deliveries_customer_idx').on(t.customerId, t.createdAt),
  ],
).enableRLS();

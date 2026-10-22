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
    // Store status lifecycle from FRD 4.1.
    status: text('status').notNull().default('invited'),
    plan: text('plan'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
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
    reason: text('reason'),
    staffId: uuid('staff_id').references(() => staffUsers.id),
    deviceId: uuid('device_id').references(() => cashierDevices.id),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    // Which branch an award happened at (D-103). Null for a store with no
    // branches, and for entries that are not tied to a place.
    locationId: uuid('location_id'),
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
      sql`(${t.type} = 'earn' and ${t.points} >= 0) or ${t.type} = 'adjust' or (${t.type} in ('redeem', 'expire', 'fraud_clawback') and ${t.points} <= 0)`,
    ),
    foreignKey({
      columns: [t.locationId, t.storeId],
      foreignColumns: [storeLocations.id, storeLocations.storeId],
      name: 'points_ledger_entries_location_store_fk',
    }),
    check(
      'points_ledger_entries_type_check',
      sql`${t.type} in ('earn', 'redeem', 'adjust', 'expire', 'fraud_clawback')`,
    ),
    // Scoped per store and per customer: a key identifies one award request.
    // A key reused for a different customer, or at a different store, is a
    // different request and must not be deduped against the first.
    uniqueIndex('points_ledger_entries_idempotency_unique')
      .on(t.storeId, t.customerId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
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

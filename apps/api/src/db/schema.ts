import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
    // FR-AUTH-3: email is unique per customer.
    uniqueIndex('customers_email_unique').on(t.email),
    check('customers_status_check', sql`${t.status} in ('active', 'deleted')`),
  ],
);

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('staff_users_email_unique').on(t.email),
    check('staff_users_status_check', sql`${t.status} in ('active', 'deactivated')`),
  ],
);

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
);

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
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('store_members_store_user_unique').on(t.storeId, t.userId),
    check('store_members_role_check', sql`${t.role} in ('owner', 'manager', 'cashier')`),
    check('store_members_status_check', sql`${t.status} in ('active', 'deactivated')`),
    index('store_members_store_idx').on(t.storeId),
  ],
);

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
);

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
);

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
);

export const pointsRules = pgTable(
  'points_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    // FR-STO-5: a rule change applies to future purchases only.
    ruleVersion: integer('rule_version').notNull(),
    pointsPerEuroThousandths: integer('points_per_euro_thousandths').notNull(),
    minPurchaseCents: integer('min_purchase_cents'),
    maxPointsPerTransaction: integer('max_points_per_transaction'),
    rounding: text('rounding').notNull().default('floor'),
    activeFrom: timestamp('active_from', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('points_rules_store_version_unique').on(t.storeId, t.ruleVersion),
    check('points_rules_rate_check', sql`${t.pointsPerEuroThousandths} > 0`),
    check('points_rules_min_purchase_check', sql`${t.minPurchaseCents} is null or ${t.minPurchaseCents} >= 0`),
    check(
      'points_rules_max_points_check',
      sql`${t.maxPointsPerTransaction} is null or ${t.maxPointsPerTransaction} >= 0`,
    ),
    check('points_rules_rounding_check', sql`${t.rounding} in ('floor', 'nearest')`),
    index('points_rules_store_idx').on(t.storeId),
  ],
);

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
    remainingPoints: integer('remaining_points'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ruleVersion: integer('rule_version'),
    reason: text('reason'),
    staffId: uuid('staff_id').references(() => staffUsers.id),
    deviceId: uuid('device_id').references(() => cashierDevices.id),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
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
    check(
      'points_ledger_entries_remaining',
      sql`${t.remainingPoints} is null or (${t.remainingPoints} >= 0 and ${t.remainingPoints} <= ${t.points})`,
    ),
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
);

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
);

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
);

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
);

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
  (t) => [index('audit_log_entries_store_idx').on(t.storeId), index('audit_log_entries_created_idx').on(t.createdAt)],
);

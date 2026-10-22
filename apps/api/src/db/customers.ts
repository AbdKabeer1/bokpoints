import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import type { CustomerPrincipal } from '../auth/session.js';
import type { Database } from './client.js';
import { isUniqueViolation } from './errors.js';
import {
  credentials,
  customers,
  pointsBalances,
  pointsBatches,
  pointsLedgerEntries,
  stores,
} from './schema.js';

export type CustomerErrorCode = 'ACCOUNT_DELETED' | 'EMAIL_ALREADY_LINKED';

/**
 * A refusal the customer routes can report as-is. It is not a database error:
 * both cases are expected answers to a sign-in attempt.
 */
export class CustomerError extends Error {
  readonly code: CustomerErrorCode;

  constructor(code: CustomerErrorCode, message: string) {
    super(message);
    this.name = 'CustomerError';
    this.code = code;
  }
}

export interface CustomerProfile {
  id: string;
  email: string;
  name: string;
  language: string;
  createdAt: Date;
}

export interface ProvisionedCustomer extends CustomerProfile {
  credentialIdentifier: string;
}

const IDENTIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * An opaque member code: `CUS-` plus 26 base32 characters from 16 random
 * bytes (128 bits). The till treats it as an ordinary `app_qr` credential;
 * the Ed25519 signature of build step 8 will wrap the same identifier rather
 * than replace it.
 */
export function customerCredentialIdentifier(): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of randomBytes(16)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += IDENTIFIER_ALPHABET[(value >>> (bits - 5)) & 31] ?? '';
      bits -= 5;
    }
  }
  if (bits > 0) output += IDENTIFIER_ALPHABET[(value << (5 - bits)) & 31] ?? '';

  return `CUS-${output}`;
}

/**
 * Finds or creates the customer behind a verified Supabase identity (D-111).
 *
 * - An existing `auth_user_id` wins, always.
 * - Otherwise an unlinked row with the same email is claimed: the one-time
 *   code just proved the caller owns that address (FR-AUTH-3).
 * - A row linked to a *different* Supabase user is never taken over; the
 *   unique email index turns that into `EMAIL_ALREADY_LINKED`.
 *
 * Every customer gets exactly one active `app_qr` credential, created here so
 * the very first screen can show a QR. Idempotent: simultaneous first calls
 * both end with the same row and the same identifier.
 */
export async function provisionCustomer(
  db: Database,
  principal: CustomerPrincipal,
): Promise<ProvisionedCustomer> {
  return db.transaction(async (tx) => {
    const byAuth = await tx
      .select()
      .from(customers)
      .where(eq(customers.authUserId, principal.authUserId))
      .limit(1);

    let row = byAuth[0];

    if (row) {
      if (row.status === 'deleted') {
        throw new CustomerError('ACCOUNT_DELETED', 'This account has been deleted');
      }
    } else {
      const byEmail = await tx
        .select()
        .from(customers)
        .where(and(sql`lower(${customers.email}) = ${principal.email}`, isNull(customers.authUserId)))
        .limit(1);

      const unlinked = byEmail[0];
      if (unlinked) {
        if (unlinked.status === 'deleted') {
          throw new CustomerError('ACCOUNT_DELETED', 'This account has been deleted');
        }

        const linked = await tx
          .update(customers)
          .set({
            authUserId: principal.authUserId,
            emailVerifiedAt: sql`coalesce(${customers.emailVerifiedAt}, now())`,
            updatedAt: new Date(),
          })
          .where(eq(customers.id, unlinked.id))
          .returning();
        row = linked[0];
      } else {
        try {
          const inserted = await tx
            .insert(customers)
            .values({
              email: principal.email,
              name: '',
              authUserId: principal.authUserId,
              emailVerifiedAt: new Date(),
            })
            .returning();
          row = inserted[0];
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new CustomerError(
              'EMAIL_ALREADY_LINKED',
              'That email already belongs to another account. Sign in with the original address.',
            );
          }
          throw error;
        }
      }
    }

    if (!row) throw new Error('Provisioning produced no customer row');

    const active = await tx
      .select({ identifier: credentials.identifier })
      .from(credentials)
      .where(
        and(
          eq(credentials.customerId, row.id),
          eq(credentials.type, 'app_qr'),
          eq(credentials.status, 'active'),
        ),
      )
      .limit(1);

    let credentialIdentifier = active[0]?.identifier;
    if (credentialIdentifier === undefined) {
      // A 128-bit random identifier cannot realistically collide, and a
      // unique violation would abort this transaction anyway, so there is
      // no retry inside it.
      const created = await tx
        .insert(credentials)
        .values({
          customerId: row.id,
          type: 'app_qr',
          identifier: customerCredentialIdentifier(),
        })
        .returning({ identifier: credentials.identifier });
      const identifier = created[0]?.identifier;
      if (identifier === undefined) throw new Error('Could not create a credential');
      credentialIdentifier = identifier;
    }

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      language: row.language,
      createdAt: row.createdAt,
      credentialIdentifier,
    };
  });
}

/** Applies a profile patch; the caller has already validated and trimmed it. */
export async function updateCustomerProfile(
  db: Database,
  customerId: string,
  patch: { name?: string | undefined; language?: string | undefined },
): Promise<CustomerProfile> {
  const rows = await db
    .update(customers)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.language === undefined ? {} : { language: patch.language }),
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId))
    .returning({
      id: customers.id,
      email: customers.email,
      name: customers.name,
      language: customers.language,
      createdAt: customers.createdAt,
    });

  const row = rows[0];
  if (!row) throw new Error('Customer disappeared while updating the profile');
  return row;
}

export interface CustomerStoreSummary {
  storeId: string;
  name: string;
  balance: number;
  lastActivityAt: Date;
}

/**
 * Every store the customer has ever had an entry at, newest activity first
 * (FR-CUS-2). A store that expired to zero stays visible: the customer's
 * history there still matters.
 */
export async function customerStores(
  db: Database,
  customerId: string,
): Promise<CustomerStoreSummary[]> {
  return db
    .select({
      storeId: pointsLedgerEntries.storeId,
      name: stores.name,
      balance: sql<number>`coalesce(max(${pointsBalances.balance}), 0)`,
      lastActivityAt: sql<Date>`max(${pointsLedgerEntries.createdAt})`,
    })
    .from(pointsLedgerEntries)
    .innerJoin(stores, eq(stores.id, pointsLedgerEntries.storeId))
    .leftJoin(
      pointsBalances,
      and(
        eq(pointsBalances.customerId, pointsLedgerEntries.customerId),
        eq(pointsBalances.storeId, pointsLedgerEntries.storeId),
      ),
    )
    .where(eq(pointsLedgerEntries.customerId, customerId))
    .groupBy(pointsLedgerEntries.storeId, stores.name)
    .orderBy(desc(sql`max(${pointsLedgerEntries.createdAt})`));
}

export interface CustomerHistoryEntry {
  id: string;
  createdAt: Date;
  type: string;
  points: number;
  balanceAfter: number;
}

export interface CustomerHistory {
  storeName: string;
  balance: number;
  entries: CustomerHistoryEntry[];
}

/**
 * The last 100 entries at one store with the balance after each (FR-CUS-3).
 * The running sum is computed over the whole ledger before the limit, so the
 * numbers stay true even for a long history.
 *
 * Null means "nothing this customer may see": an unknown store or a store
 * where they have no entries both answer the same way.
 */
export async function customerStoreHistory(
  db: Database,
  customerId: string,
  storeId: string,
): Promise<CustomerHistory | null> {
  const storeRows = await db
    .select({ name: stores.name })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  const store = storeRows[0];
  if (!store) return null;

  const entries = await db
    .select({
      id: pointsLedgerEntries.id,
      createdAt: pointsLedgerEntries.createdAt,
      type: pointsLedgerEntries.type,
      points: pointsLedgerEntries.points,
      // SUM(integer) is bigint in Postgres, which the driver returns as a
      // string; the cast keeps it a number all the way to the client.
      balanceAfter: sql<number>`(sum(${pointsLedgerEntries.points}) over (order by ${pointsLedgerEntries.createdAt}, ${pointsLedgerEntries.id}))::int`,
    })
    .from(pointsLedgerEntries)
    .where(
      and(
        eq(pointsLedgerEntries.customerId, customerId),
        eq(pointsLedgerEntries.storeId, storeId),
      ),
    )
    .orderBy(desc(pointsLedgerEntries.createdAt), desc(pointsLedgerEntries.id))
    .limit(100);

  if (entries.length === 0) return null;

  const balanceRows = await db
    .select({ balance: pointsBalances.balance })
    .from(pointsBalances)
    .where(and(eq(pointsBalances.customerId, customerId), eq(pointsBalances.storeId, storeId)))
    .limit(1);

  return {
    storeName: store.name,
    balance: balanceRows[0]?.balance ?? 0,
    entries,
  };
}

export interface CustomerExpiringItem {
  storeId: string;
  storeName: string;
  points: number;
  expiresAt: Date;
}

/** Batches still alive that expire within the window (FR-CUS-8, FR-PTS-10). */
export async function customerExpiring(
  db: Database,
  customerId: string,
  days: number,
): Promise<CustomerExpiringItem[]> {
  return db
    .select({
      storeId: pointsBatches.storeId,
      storeName: stores.name,
      points: pointsBatches.remainingPoints,
      expiresAt: pointsBatches.expiresAt,
    })
    .from(pointsBatches)
    .innerJoin(stores, eq(stores.id, pointsBatches.storeId))
    .where(
      and(
        eq(pointsBatches.customerId, customerId),
        gt(pointsBatches.remainingPoints, 0),
        gt(pointsBatches.expiresAt, sql`now()`),
        lte(pointsBatches.expiresAt, sql`now() + make_interval(days => ${days})`),
      ),
    )
    .orderBy(pointsBatches.expiresAt);
}

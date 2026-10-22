import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { recordAdjust, recordEarn } from '../../src/db/ledger.js';
import { runExpiry } from '../../src/db/expiry.js';
import { applyMigrations, truncateAll } from './setup.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

let pool: ReturnType<typeof createPool>;
let db: Database;

let storeId: string;
let otherStoreId: string;
let customerId: string;
let otherCustomerId: string;
let staffId: string;
let ruleVersion: number;
const rule = { pointsPerEuroThousandths: 1000, rounding: 'floor' as const };

const expireAllBatchesAt = async (storeIdToExpire: string) => {
  await pool.query(
    "UPDATE points_batches SET expires_at = now() - interval '1 day' WHERE store_id = $1",
    [storeIdToExpire],
  );
};

const award = async (store: string, customer: string, amountCents: number) => {
  const result = await recordEarn(db, {
    customerId: customer,
    storeId: store,
    amountCents,
    rule,
    ruleVersion,
    idempotencyKey: randomUUID(),
    staffId,
  });
  if (!result.awarded) throw new Error(`award refused: ${result.reason}`);
};

const expireEntryCount = async (store: string) => {
  const rows = await pool.query(
    "SELECT count(*) FROM points_ledger_entries WHERE store_id = $1 AND type = 'expire'",
    [store],
  );
  return Number(rows.rows[0].count);
};

const balance = async (store: string, customer: string) => {
  const rows = await pool.query(
    'SELECT balance FROM points_balances WHERE store_id = $1 AND customer_id = $2',
    [store, customer],
  );
  return rows.rows[0]?.balance ?? 0;
};

beforeAll(async () => {
  pool = createPool(DATABASE_URL);
  await applyMigrations(pool);
  db = createDb(pool);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
  storeId = randomUUID();
  otherStoreId = randomUUID();
  customerId = randomUUID();
  otherCustomerId = randomUUID();
  staffId = randomUUID();

  await pool.query('INSERT INTO staff_users (id, email, name) VALUES ($1, $2, $3)', [
    staffId,
    'clerk@test.dev',
    'Clerk',
  ]);
  await pool.query(
    `INSERT INTO stores (id, name, status)
     VALUES ($1, 'Main Shop', 'active'), ($2, 'Other Shop', 'active')`,
    [storeId, otherStoreId],
  );
  await pool.query(
    `INSERT INTO points_rules (store_id, rule_version, points_per_euro_thousandths, rounding, active_from)
     SELECT id, 1, 1000, 'floor', now() FROM stores`,
  );
  ruleVersion = 1;
  await pool.query(
    `INSERT INTO customers (id, email, name)
     VALUES ($1, 'customer@test.dev', 'Aino'), ($2, 'other@test.dev', 'Berto')`,
    [customerId, otherCustomerId],
  );
});

describe('the points expiry job', () => {
  it('expires a due batch once and drops the points off the balance', async () => {
    await award(storeId, customerId, 1000);
    await expireAllBatchesAt(storeId);

    const result = await runExpiry(db);

    expect(result).toEqual({ expiredEntries: 1, pointsExpired: 10 });
    expect(await expireEntryCount(storeId)).toBe(1);
    expect(await balance(storeId, customerId)).toBe(0);

    const batch = await pool.query('SELECT remaining_points FROM points_batches');
    expect(batch.rows).toEqual([{ remaining_points: 0 }]);

    const entry = await pool.query(
      "SELECT points, customer_id, store_id, expires_at IS NOT NULL AS has_expiry, type FROM points_ledger_entries WHERE store_id = $1 AND type = 'expire'",
      [storeId],
    );
    expect(entry.rows[0]).toMatchObject({
      points: -10,
      customer_id: customerId,
      store_id: storeId,
      has_expiry: true,
      type: 'expire',
    });
  });

  it('does not expire anything twice when run again the same day', async () => {
    await award(storeId, customerId, 1000);
    await expireAllBatchesAt(storeId);
    await runExpiry(db);

    const secondRun = await runExpiry(db);

    expect(secondRun).toEqual({ expiredEntries: 0, pointsExpired: 0 });
    expect(await expireEntryCount(storeId)).toBe(1);
    expect(await balance(storeId, customerId)).toBe(0);
  });

  it('expires each batch once when two runs race each other', async () => {
    await award(storeId, customerId, 1000);
    await award(otherStoreId, otherCustomerId, 500);
    await expireAllBatchesAt(storeId);
    await expireAllBatchesAt(otherStoreId);

    const [a, b] = await Promise.all([runExpiry(db), runExpiry(db)]);

    expect(a.expiredEntries + b.expiredEntries).toBe(2);
    expect(a.pointsExpired + b.pointsExpired).toBe(15);
    expect(await expireEntryCount(storeId)).toBe(1);
    expect(await expireEntryCount(otherStoreId)).toBe(1);
    expect(await balance(storeId, customerId)).toBe(0);
    expect(await balance(otherStoreId, otherCustomerId)).toBe(0);
  });

  it('respects a manual drawdown: only the remainder is expired', async () => {
    await award(storeId, customerId, 1000);
    await recordAdjust(db, {
      customerId,
      storeId,
      points: -3,
      reason: 'wrong purchase entered',
      staffId,
    });
    await expireAllBatchesAt(storeId);

    const result = await runExpiry(db);

    expect(result).toEqual({ expiredEntries: 1, pointsExpired: 7 });
    expect(await balance(storeId, customerId)).toBe(0);
    const entries = await pool.query(
      "SELECT type, points FROM points_ledger_entries WHERE store_id = $1 ORDER BY type",
      [storeId],
    );
    expect(entries.rows).toEqual([
      { type: 'adjust', points: -3 },
      { type: 'earn', points: 10 },
      { type: 'expire', points: -7 },
    ]);
  });

  it('expires store by store and customer by customer', async () => {
    // This store's batch is due; the other store's is not.
    await award(storeId, customerId, 1000);
    await award(otherStoreId, otherCustomerId, 500);
    await expireAllBatchesAt(storeId);

    const result = await runExpiry(db);

    expect(result).toEqual({ expiredEntries: 1, pointsExpired: 10 });
    expect(await expireEntryCount(otherStoreId)).toBe(0);
    expect(await balance(otherStoreId, otherCustomerId)).toBe(5);
  });

  it('leaves the audit trail and never crosses a not-yet-due batch', async () => {
    await award(storeId, customerId, 1000);
    await expireAllBatchesAt(storeId);
    await runExpiry(db);

    const rows = await pool.query(
      "SELECT actor_id, actor_role, action, target_type, target_id FROM audit_log_entries WHERE action = 'points.expire'",
    );
    expect(rows.rows[0]).toMatchObject({
      actor_id: null,
      actor_role: null,
      action: 'points.expire',
      target_type: 'customer',
      target_id: customerId,
    });
  });
});

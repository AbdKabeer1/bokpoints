import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDevSessionResolver } from '../../src/auth/dev-session.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { applyMigrations, truncateAll } from './setup.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

let pool: ReturnType<typeof createPool>;
let db: Database;

let storeId: string;
let customerId: string;

async function inject(
  method: 'GET' | 'POST',
  url: string,
  token: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  const app = await buildApp({ db, sessionResolver: createDevSessionResolver(db) });
  const res = await app.inject({
    method,
    url,
    headers: {
      ...(token === '' ? {} : { authorization: `Bearer ${token}` }),
      ...(headers ?? {}),
    },
    ...(body === undefined ? {} : { payload: body as object }),
  });
  await app.close();
  return res;
}

const award = (key: string, body: Record<string, unknown>, token = 'cashier@test.dev') =>
  inject('POST', `/v1/stores/${storeId}/awards`, token, body, { 'idempotency-key': key });

const reverse = (saleId: string, body: unknown, token = 'cashier@test.dev') =>
  inject('POST', `/v1/stores/${storeId}/sales/${saleId}/reversal`, token, body);

const available = (targetCustomerId: string, paidCents?: number) =>
  inject(
    'GET',
    `/v1/stores/${storeId}/rewards/available?customerId=${targetCustomerId}${
      paidCents === undefined ? '' : `&paidCents=${paidCents}`
    }`,
    'cashier@test.dev',
  );

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
  customerId = randomUUID();

  await pool.query(
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'owner@test.dev', 'Otto Owner', false)",
    [randomUUID()],
  );
  await pool.query(
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'cashier@test.dev', 'Cai Cashier', false)",
    [randomUUID()],
  );
  await pool.query(
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'mate@test.dev', 'Mai Mate', false)",
    [randomUUID()],
  );
  await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, 'Policy Store', 'active')", [
    storeId,
  ]);

  const owner = await pool.query("SELECT id FROM staff_users WHERE email = 'owner@test.dev'");
  await pool.query("INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, 'owner')", [
    storeId,
    owner.rows[0].id,
  ]);
  const cashier = await pool.query("SELECT id FROM staff_users WHERE email = 'cashier@test.dev'");
  await pool.query(
    "INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, 'cashier')",
    [storeId, cashier.rows[0].id],
  );
  const mate = await pool.query("SELECT id FROM staff_users WHERE email = 'mate@test.dev'");
  await pool.query(
    "INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, 'cashier')",
    [storeId, mate.rows[0].id],
  );

  await pool.query(
    "INSERT INTO customers (id, email, name, status) VALUES ($1, 'sale@mail.test', 'Salla Sale', 'active')",
    [customerId],
  );

  // One point per euro, so every number is readable.
  const rule = await inject('POST', `/v1/stores/${storeId}/rules`, 'owner@test.dev', {
    definition: { type: 'per_euro', pointsPerEuroThousandths: 1000, rounding: 'floor' },
  });
  expect(rule.statusCode).toBe(201);
});

describe('the reversal policy (D-143)', () => {
  it('a cashier can reverse their own fresh sale', async () => {
    const confirmed = await award('pol-1', { customerId, amountCents: 1000 });
    const { saleId } = confirmed.json();

    const res = await reverse(saleId, { reason: 'wrong amount' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ reversedPoints: -10, restoredPoints: 0 });
  });

  it('a cashier cannot reverse a sale another cashier recorded', async () => {
    const confirmed = await award('pol-2', { customerId, amountCents: 1000 });
    const { saleId } = confirmed.json();

    const res = await reverse(saleId, { reason: 'not mine' }, 'mate@test.dev');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'REVERSAL_NOT_ALLOWED', message: expect.any(String) },
    });
  });

  it('after the window a cashier is refused and an owner is allowed', async () => {
    const confirmed = await award('pol-3', { customerId, amountCents: 1000 });
    const { saleId } = confirmed.json();

    // The sale is twenty minutes old.
    await pool.query("UPDATE sales SET created_at = now() - interval '20 minutes' WHERE id = $1", [
      saleId,
    ]);

    const cashier = await reverse(saleId, { reason: 'too late for me' });
    expect(cashier.statusCode).toBe(403);
    expect(cashier.json()).toEqual({
      error: { code: 'REVERSAL_NOT_ALLOWED', message: expect.any(String) },
    });

    const owner = await reverse(saleId, { reason: 'wrong amount at the till' }, 'owner@test.dev');
    expect(owner.statusCode).toBe(200);
    expect(owner.json()).toMatchObject({ reversedPoints: -10 });
  });

  it('the reason is required', async () => {
    const confirmed = await award('pol-4', { customerId, amountCents: 1000 });
    const { saleId } = confirmed.json();

    const missing = await reverse(saleId, {});
    expect(missing.statusCode).toBe(400);

    const blank = await reverse(saleId, { reason: '   ' });
    expect(blank.statusCode).toBe(400);
  });

  it('a branch-limited member may only reverse their own branch', async () => {
    // This test brings its own branches: Lee A is a cashier of branch A,
    // Bea B an owner limited to branch B.
    const branchA = randomUUID();
    const branchB = randomUUID();
    await pool.query(
      "INSERT INTO store_locations (id, store_id, name, status) VALUES ($1, $2, 'Branch A', 'active')",
      [branchA, storeId],
    );
    await pool.query(
      "INSERT INTO store_locations (id, store_id, name, status) VALUES ($1, $2, 'Branch B', 'active')",
      [branchB, storeId],
    );
    await pool.query(
      "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'limitA@test.dev', 'Lee A', false)",
      [randomUUID()],
    );
    await pool.query(
      "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'limitB@test.dev', 'Bea B', false)",
      [randomUUID()],
    );
    const limitA = await pool.query("SELECT id FROM staff_users WHERE email = 'limitA@test.dev'");
    await pool.query(
      "INSERT INTO store_members (store_id, user_id, role, location_id) VALUES ($1, $2, 'cashier', $3)",
      [storeId, limitA.rows[0].id, branchA],
    );
    const limitB = await pool.query("SELECT id FROM staff_users WHERE email = 'limitB@test.dev'");
    await pool.query(
      "INSERT INTO store_members (store_id, user_id, role, location_id) VALUES ($1, $2, 'owner', $3)",
      [storeId, limitB.rows[0].id, branchB],
    );

    // Branch A's sale, fresh, recorded by Lee A.
    const confirmed = await award('pol-5', { customerId, amountCents: 1000, locationId: branchA }, 'limitA@test.dev');
    const { saleId } = confirmed.json();

    // Bea B owns the store but is limited to branch B: outside her branch,
    // whatever her role.
    const otherBranch = await reverse(saleId, { reason: 'wrong branch' }, 'limitB@test.dev');
    expect(otherBranch.statusCode).toBe(403);
    expect(otherBranch.json()).toEqual({
      error: { code: 'LOCATION_MISMATCH', message: expect.any(String) },
    });

    // The sale's own branch cashier may reverse it.
    const ownBranch = await reverse(saleId, { reason: 'wrong amount' }, 'limitA@test.dev');
    expect(ownBranch.statusCode).toBe(200);

    // A second sale at branch B, reversed by the unlimited owner.
    const again = await award('pol-6', { customerId, amountCents: 500, locationId: branchB });
    const ownerReversal = await reverse(
      again.json().saleId,
      { reason: 'wrong amount' },
      'owner@test.dev',
    );
    expect(ownerReversal.statusCode).toBe(200);
  });
});

describe("the reward day is the store's local day (D-144)", () => {
  it('a take at Helsinki midnight counts as today, so the limit still holds', async () => {
    const reward = await createReward({ name: 'One a day', pointsCost: 1, perCustomerPerDayLimit: 1 });
    const rewardId = reward.json().rewardId;
    await award('day-1', { customerId, amountCents: 1000 });

    // The take actually happened at half past midnight, Helsinki time —
    // after the local day began. In UTC that instant is still yesterday,
    // which is exactly what the old UTC-day check got wrong. The ledger is
    // append-only, so the take is inserted directly at that instant.
    await pool.query(
      `INSERT INTO points_ledger_entries
         (customer_id, store_id, type, points, reward_id, reason, created_at)
       VALUES ($1, $2, 'redeem', -1, $3, 'Reward: One a day',
         ((date_trunc('day', now() at time zone 'Europe/Helsinki') + interval '30 minutes')
            at time zone 'Europe/Helsinki'))`,
      [customerId, storeId, rewardId],
    );

    const second = await award('day-3', { customerId, amountCents: 500, redeemRewardId: rewardId });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({
      error: { code: 'REWARD_LIMIT_REACHED', message: expect.any(String) },
    });
  });
});

describe('the double-redemption race (D-143)', () => {
  it('two tills confirming at once: the daily limit lets exactly one through', async () => {
    const reward = await createReward({
      name: 'One a day',
      pointsCost: 1,
      perCustomerPerDayLimit: 1,
    });
    const rewardId = reward.json().rewardId;
    await award('race-1', { customerId, amountCents: 1000 });

    const app = await buildApp({ db, sessionResolver: createDevSessionResolver(db) });
    const calls = [0, 1, 2].map((index) =>
      app.inject({
        method: 'POST',
        url: `/v1/stores/${storeId}/awards`,
        headers: {
          authorization: 'Bearer cashier@test.dev',
          'idempotency-key': `race-red-${index}`,
        },
        payload: { customerId, amountCents: 500, redeemRewardId: rewardId },
      }),
    );
    const responses = await Promise.all(calls);
    await app.close();

    const taken = responses.filter((res) => res.statusCode === 201);
    expect(taken).toHaveLength(1); // the limit is one per day
    const refused = responses.filter((res) => res.statusCode === 409);
    expect(refused).toHaveLength(2);
    for (const res of refused) {
      expect(res.json()).toEqual({
        error: { code: 'REWARD_LIMIT_REACHED', message: expect.any(String) },
      });
    }

    const redeems = await pool.query(
      "SELECT count(*)::int AS n FROM points_ledger_entries WHERE type = 'redeem' AND store_id = $1",
      [storeId],
    );
    expect(redeems.rows[0].n).toBe(1);
  });
});

describe('the picker counts what the purchase will earn (D-145)', () => {
  it('a customer with no points sees a reward their new purchase covers', async () => {
    await createReward({ name: 'Small coffee', pointsCost: 5 });

    const withoutPurchase = await available(customerId);
    expect(withoutPurchase.json().rewards[0]).toMatchObject({ affordable: false });

    // A €10 purchase at one point per euro earns 10 points — enough.
    const withPurchase = await available(customerId, 1000);
    expect(withPurchase.json().rewards[0]).toMatchObject({ affordable: true });
  });
});

async function createReward(body: Record<string, unknown>) {
  return inject('POST', `/v1/stores/${storeId}/rewards`, 'owner@test.dev', body);
}

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDevCustomerResolver, createDevSessionResolver, uuidFromEmail } from '../../src/auth/dev-session.js';
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
  const app = await buildApp({
    db,
    sessionResolver: createDevSessionResolver(db),
    customerResolver: createDevCustomerResolver(),
  });
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

const createReward = (
  body: Record<string, unknown>,
  token = 'owner@test.dev',
) => inject('POST', `/v1/stores/${storeId}/rewards`, token, body);

const editReward = (rewardId: string, body: Record<string, unknown>) =>
  inject('POST', `/v1/stores/${storeId}/rewards/${rewardId}`, 'owner@test.dev', body);

const available = (targetCustomerId: string) =>
  inject(
    'GET',
    `/v1/stores/${storeId}/rewards/available?customerId=${targetCustomerId}`,
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
  await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, 'Reward Store', 'active')", [
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
  await pool.query(
    "INSERT INTO customers (id, email, name, status) VALUES ($1, 'sale@mail.test', 'Salla Sale', 'active')",
    [customerId],
  );

  // One point per euro, so every number in the assertions is readable.
  const rule = await inject('POST', `/v1/stores/${storeId}/rules`, 'owner@test.dev', {
    definition: { type: 'per_euro', pointsPerEuroThousandths: 1000, rounding: 'floor' },
  });
  expect(rule.statusCode).toBe(201);
});

describe('the rewards catalog (D-138)', () => {
  it('the owner creates a reward and lists it; a cashier cannot create', async () => {
    const created = await createReward({
      name: '  Free coffee  ',
      pointsCost: 300,
      perCustomerPerDayLimit: 1,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Free coffee', pointsCost: 300, active: true });

    const list = await inject('GET', `/v1/stores/${storeId}/rewards`, 'owner@test.dev');
    expect(list.json().rewards).toHaveLength(1);

    const byCashier = await createReward({ name: 'Free bagel', pointsCost: 500 }, 'cashier@test.dev');
    expect(byCashier.statusCode).toBe(403);
  });

  it('the till picker says what this customer can afford, and when the daily limit is used', async () => {
    const reward = await createReward({ name: 'Small coffee', pointsCost: 5 });
    const rewardId = reward.json().rewardId;

    const broke = await available(customerId);
    expect(broke.json().rewards[0]).toMatchObject({
      rewardId,
      affordable: false,
      redeemedToday: 0,
      limitReached: false,
    });

    await award('rich-1', { customerId, amountCents: 1000 });
    const rich = await available(customerId);
    expect(rich.json()).toMatchObject({ balance: 10 });
    expect(rich.json().rewards[0].affordable).toBe(true);

    await editReward(rewardId, { perCustomerPerDayLimit: 1 });
    await award('take-1', { customerId, amountCents: 500, redeemRewardId: rewardId });
    const afterTake = await available(customerId);
    expect(afterTake.json().rewards[0]).toMatchObject({
      affordable: false,
      redeemedToday: 1,
      limitReached: true,
    });
  });

  it('a confirm earns points and pays for a reward in one action', async () => {
    const reward = await createReward({ name: 'Free coffee', pointsCost: 3 });
    const rewardId = reward.json().rewardId;
    await award('seed-1', { customerId, amountCents: 1000 });

    const res = await award('take-2', {
      customerId,
      amountCents: 500,
      redeemRewardId: rewardId,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      points: 5,
      redeemed: { rewardId, name: 'Free coffee', pointsCost: -3 },
    });

    const balance = await inject(
      'GET',
      `/v1/stores/${storeId}/customers/${customerId}/balance`,
      'cashier@test.dev',
    );
    expect(balance.json().balance).toBe(12); // 10 + 5 - 3

    const redeem = await pool.query(
      "SELECT * FROM points_ledger_entries WHERE type = 'redeem' AND store_id = $1",
      [storeId],
    );
    expect(redeem.rows).toHaveLength(1);
    expect(redeem.rows[0]).toMatchObject({ points: -3, reward_id: rewardId, customer_id: customerId });
    expect(redeem.rows[0].staff_id).not.toBeNull();
    expect(redeem.rows[0].sale_id).toBe(res.json().saleId);

    const audit = await pool.query(
      "SELECT count(*)::int AS n FROM audit_log_entries WHERE action = 'points.redeem' AND store_id = $1",
      [storeId],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('refuses a reward the customer cannot afford and writes nothing', async () => {
    const reward = await createReward({ name: 'Weekend brunch', pointsCost: 50 });

    const res = await award('poor-1', {
      customerId,
      amountCents: 1000,
      redeemRewardId: reward.json().rewardId,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: 'REWARD_NOT_AFFORDABLE', message: expect.any(String) },
    });

    const entries = await pool.query(
      'SELECT count(*)::int AS n FROM points_ledger_entries WHERE customer_id = $1',
      [customerId],
    );
    expect(entries.rows[0].n).toBe(0); // the whole confirm rolled back
    const sales = await pool.query('SELECT count(*)::int AS n FROM sales WHERE store_id = $1', [
      storeId,
    ]);
    expect(sales.rows[0].n).toBe(0);
  });

  it('refuses an inactive reward with 409 and an unknown one with 404', async () => {
    const reward = await createReward({ name: 'Retired reward', pointsCost: 1 });
    await award('seed-2', { customerId, amountCents: 5000 });
    await editReward(reward.json().rewardId, { active: false });

    const inactive = await award('dead-1', {
      customerId,
      amountCents: 500,
      redeemRewardId: reward.json().rewardId,
    });
    expect(inactive.statusCode).toBe(409);
    expect(inactive.json()).toEqual({
      error: { code: 'REWARD_NOT_ACTIVE', message: expect.any(String) },
    });

    const unknown = await award('dead-2', {
      customerId,
      amountCents: 500,
      redeemRewardId: randomUUID(),
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({
      error: { code: 'REWARD_NOT_FOUND', message: expect.any(String) },
    });
  });

  it('the daily limit is one per customer, and only for today', async () => {
    const reward = await createReward({
      name: 'One a day',
      pointsCost: 1,
      perCustomerPerDayLimit: 1,
    });
    const rewardId = reward.json().rewardId;
    await award('seed-3', { customerId, amountCents: 1000 });

    const second = randomUUID();
    await pool.query(
      "INSERT INTO customers (id, email, name, status) VALUES ($1, 'two@mail.test', 'Tomi Two', 'active')",
      [second],
    );

    const first = await award('limit-1', { customerId, amountCents: 500, redeemRewardId: rewardId });
    expect(first.statusCode).toBe(201);

    const again = await award('limit-2', { customerId, amountCents: 500, redeemRewardId: rewardId });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({
      error: { code: 'REWARD_LIMIT_REACHED', message: expect.any(String) },
    });

    // The next customer's day is their own.
    await award('limit-3', { customerId: second, amountCents: 500 });
    const other = await award('limit-4', {
      customerId: second,
      amountCents: 500,
      redeemRewardId: rewardId,
    });
    expect(other.statusCode).toBe(201);
  });

  it('a replayed confirm is still one redemption, and the receipt survives', async () => {
    const reward = await createReward({ name: 'Free cookie', pointsCost: 2 });
    const rewardId = reward.json().rewardId;
    await award('seed-4', { customerId, amountCents: 1000 });

    const body = { customerId, amountCents: 500, redeemRewardId: rewardId };
    const first = await award('replay-red', body);
    const second = await award('replay-red', body);
    expect(second.json().entryId).toBe(first.json().entryId);
    expect(second.json().redeemed).toEqual({
      rewardId,
      name: 'Free cookie',
      pointsCost: -2,
    });

    const redeems = await pool.query(
      "SELECT count(*)::int AS n FROM points_ledger_entries WHERE type = 'redeem' AND store_id = $1",
      [storeId],
    );
    expect(redeems.rows[0].n).toBe(1);
  });

  it('reversing the sale returns the earned points but keeps the reward', async () => {
    const reward = await createReward({ name: 'Free coffee', pointsCost: 3 });
    const rewardId = reward.json().rewardId;
    await award('seed-5', { customerId, amountCents: 1000 });

    const taken = await award('reverse-red', {
      customerId,
      amountCents: 500,
      redeemRewardId: rewardId,
    });
    const { saleId } = taken.json();

    const reversal = await inject(
      'POST',
      `/v1/stores/${storeId}/sales/${saleId}/reversal`,
      'cashier@test.dev',
      {},
    );
    expect(reversal.statusCode).toBe(200);

    const balance = await inject(
      'GET',
      `/v1/stores/${storeId}/customers/${customerId}/balance`,
      'cashier@test.dev',
    );
    expect(balance.json().balance).toBe(7); // 10 - 3: the reward stands

    const redeems = await pool.query(
      "SELECT count(*)::int AS n FROM points_ledger_entries WHERE type = 'redeem' AND store_id = $1",
      [storeId],
    );
    expect(redeems.rows[0].n).toBe(1);
  });

  it('the customer app lists the active catalog, and only theirs to see', async () => {
    await createReward({ name: 'On the house', pointsCost: 100 });
    const gone = await createReward({ name: 'Last week\'s special', pointsCost: 200 });
    await editReward(gone.json().rewardId, { active: false });

    const email = 'reader@mail.test';
    await pool.query(
      'INSERT INTO customers (id, email, name, status, auth_user_id) VALUES ($1, $2, \'Reader\', \'active\', $3)',
      [randomUUID(), email, uuidFromEmail(email)],
    );

    const res = await inject('GET', `/v1/customer/stores/${storeId}/rewards`, email);
    expect(res.statusCode).toBe(200);
    expect(res.json().rewards).toHaveLength(1);
    expect(res.json().rewards[0]).toMatchObject({ name: 'On the house', pointsCost: 100 });
  });
});

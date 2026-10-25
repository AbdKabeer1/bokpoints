import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import {
  createDevCustomerResolver,
  createDevSessionResolver,
} from '../../src/auth/dev-session.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { applyMigrations, truncateAll } from './setup.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

let pool: ReturnType<typeof createPool>;
let db: Database;

let storeId: string;
let customerId: string;
let rewardId: string;

async function inject(
  method: 'GET' | 'POST',
  url: string,
  token: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  const app = await buildApp({
    db,
    logger: false,
    sessionResolver: createDevSessionResolver(db),
    customerResolver: createDevCustomerResolver(),
  });
  const auth = token === '' ? {} : { authorization: `Bearer ${token}` };
  const res =
    body === undefined
      ? await app.inject({ method, url, headers: { ...auth, ...(headers ?? {}) } })
      : await app.inject({
          method,
          url,
          headers: { ...auth, ...(headers ?? {}) },
          payload: body,
        });
  await app.close();
  return res;
}

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
  await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, 'Pilot Store', 'active')", [
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
    "INSERT INTO customers (id, email, name, status) VALUES ($1, 'pilot@mail.test', 'Pilvi Pilot', 'active')",
    [customerId],
  );
  await pool.query(
    "INSERT INTO credentials (customer_id, type, identifier, status) VALUES ($1, 'app_qr', 'CUS-PILOT-1', 'active')",
    [customerId],
  );

  const rule = await inject('POST', `/v1/stores/${storeId}/rules`, 'owner@test.dev', {
    definition: { type: 'per_euro', pointsPerEuroThousandths: 1000, rounding: 'floor' },
  });
  expect(rule.statusCode).toBe(201);

  const reward = await inject('POST', `/v1/stores/${storeId}/rewards`, 'owner@test.dev', {
    name: 'Free coffee',
    pointsCost: 5,
  });
  expect(reward.statusCode).toBe(201);
  rewardId = reward.json().rewardId as string;
});

describe('the pilot path (B4)', () => {
  it('scans, quotes, pays, confirms, redeems and reverses one sale', async () => {
    const identified = await inject(
      'POST',
      `/v1/stores/${storeId}/identify`,
      'cashier@test.dev',
      { credentialIdentifier: 'CUS-PILOT-1', credentialType: 'app_qr' },
    );
    expect(identified.statusCode).toBe(200);
    expect(identified.json()).toMatchObject({ customerId, firstName: 'Pilvi', balance: 0 });

    const body = { customerId, amountCents: 1000, redeemRewardId: rewardId };
    const quote = await inject(
      'POST',
      `/v1/stores/${storeId}/awards/preview`,
      'cashier@test.dev',
      body,
    );
    expect(quote.statusCode).toBe(200);
    expect(quote.json().points).toBe(10);
    expect(quote.json().redeemed).toMatchObject({
      rewardId,
      affordable: true,
      limitReached: false,
    });

    const confirmed = await inject(
      'POST',
      `/v1/stores/${storeId}/awards`,
      'cashier@test.dev',
      body,
      { 'idempotency-key': randomUUID() },
    );
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json().points).toBe(10);
    expect(confirmed.json().redeemed).toMatchObject({ rewardId, name: 'Free coffee' });
    const saleId = confirmed.json().saleId as string;

    const balance = await inject(
      'GET',
      `/v1/stores/${storeId}/customers/${customerId}/balance`,
      'cashier@test.dev',
    );
    expect(balance.statusCode).toBe(200);
    expect(balance.json().balance).toBe(5);

    const reversed = await inject(
      'POST',
      `/v1/stores/${storeId}/sales/${saleId}/reversal`,
      'cashier@test.dev',
      { reason: 'Customer changed their mind' },
    );
    expect(reversed.statusCode).toBe(200);
    expect(reversed.json().reversedPoints).toBe(-10);
    expect(reversed.json().restoredPoints).toBe(5);
    expect(reversed.json().balance).toBe(0);

    const sale = await pool.query('SELECT status FROM sales WHERE id = $1', [saleId]);
    expect(sale.rows[0].status).toBe('reversed');

    const entries = await pool.query(
      'SELECT type, points FROM points_ledger_entries WHERE sale_id = $1 ORDER BY created_at',
      [saleId],
    );
    expect(entries.rows).toContainEqual({ type: 'earn', points: 10 });
    expect(entries.rows).toContainEqual({ type: 'redeem', points: -5 });
    expect(entries.rows.filter((row) => row.type === 'reversal').length).toBe(2);
  });
});

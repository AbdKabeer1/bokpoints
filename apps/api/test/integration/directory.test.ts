import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDevCustomerResolver } from '../../src/auth/dev-session.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { applyMigrations, truncateAll } from './setup.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

let pool: ReturnType<typeof createPool>;
let db: Database;

const CUSTOMER = 'directory@test.dev';

async function inject(url: string, token: string) {
  const app = await buildApp({ db, customerResolver: createDevCustomerResolver() });
  const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
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
});

describe('GET /v1/customer/stores', () => {
  it('lists active stores with this customer’s balance and visit state', async () => {
    const me = await inject('/v1/customer/me', CUSTOMER);
    const customerId = me.json().customer.id as string;

    const visited = randomUUID();
    const unvisited = randomUUID();
    const closed = randomUUID();

    await pool.query(
      "INSERT INTO stores (id, name, status, brand_color) VALUES ($1, 'Visited Store', 'active', '#123456'), ($2, 'New Store', 'active', NULL), ($3, 'Closed Store', 'paused', NULL)",
      [visited, unvisited, closed],
    );
    await pool.query(
      "INSERT INTO customer_store_links (customer_id, store_id) VALUES ($1, $2)",
      [customerId, visited],
    );
    await pool.query(
      "INSERT INTO points_balances (customer_id, store_id, balance) VALUES ($1, $2, 42)",
      [customerId, visited],
    );

    const res = await inject('/v1/customer/stores', CUSTOMER);
    expect(res.statusCode).toBe(200);

    const stores = res.json().stores as Array<Record<string, unknown>>;
    expect(stores.map((store) => store.name)).toEqual(['New Store', 'Visited Store']);

    const visitedRow = stores.find((store) => store.name === 'Visited Store');
    expect(visitedRow).toMatchObject({ visited: true, balance: 42, brandColor: '#123456' });

    const newRow = stores.find((store) => store.name === 'New Store');
    expect(newRow).toMatchObject({ visited: false, balance: 0 });
  });

  it('lists active basket offers only for stores the customer joined', async () => {
    const me = await inject('/v1/customer/me', CUSTOMER);
    const customerId = me.json().customer.id as string;
    const joined = randomUUID();
    const other = randomUUID();

    await pool.query(
      "INSERT INTO stores (id, name, status) VALUES ($1, 'Joined Store', 'active'), ($2, 'Other Store', 'active')",
      [joined, other],
    );
    await pool.query(
      "INSERT INTO customer_store_links (customer_id, store_id) VALUES ($1, $2)",
      [customerId, joined],
    );
    await pool.query(
      `INSERT INTO discount_rules (store_id, threshold_cents, kind, value, active)
       VALUES ($1, 2000, 'fixed_cents', 200, true), ($2, 1500, 'percent', 10000, true)`,
      [joined, other],
    );

    const res = await inject('/v1/customer/me/offers', CUSTOMER);
    expect(res.statusCode).toBe(200);
    expect(res.json().offers).toHaveLength(1);
    expect(res.json().offers[0]).toMatchObject({
      storeId: joined,
      storeName: 'Joined Store',
      thresholdCents: 2000,
      kind: 'fixed_cents',
      value: 200,
    });
  });
});

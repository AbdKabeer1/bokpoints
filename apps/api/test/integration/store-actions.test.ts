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
let otherStoreId: string;

async function staffUser(email: string, isAdmin = false): Promise<string> {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO staff_users (id, email, name, is_admin, status) VALUES ($1, $2, $3, $4, $5)',
    [id, email, email, isAdmin, 'active'],
  );
  return id;
}

interface InjectOptions {
  method?: 'GET' | 'POST';
  url: string;
  token: string | null;
  payload?: Record<string, unknown>;
}

async function inject(options: InjectOptions) {
  const app = await buildApp({ db, sessionResolver: createDevSessionResolver(db) });
  const res = await app.inject({
    method: options.method ?? 'GET',
    url: options.url,
    headers: options.token === null ? {} : { authorization: `Bearer ${options.token}` },
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  });
  await app.close();
  return res;
}

const post = (url: string, token: string | null, payload: Record<string, unknown>) =>
  inject({ method: 'POST', url, token, payload });

const get = (url: string, token: string | null) => inject({ url, token });

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

  await staffUser('admin@test.dev', true);
  const ownerId = await staffUser('owner@test.dev');
  const managerId = await staffUser('manager@test.dev');
  const cashierId = await staffUser('cashier@test.dev');
  const otherOwnerId = await staffUser('other.owner@test.dev');

  await pool.query(
    `INSERT INTO stores (id, name, status)
     VALUES ($1, 'Kahvila Test', 'active'), ($2, 'Other Shop', 'active')`,
    [storeId, otherStoreId],
  );

  await pool.query(
    `INSERT INTO store_members (store_id, user_id, role)
     VALUES ($1, $2, 'owner'), ($1, $3, 'manager'), ($1, $4, 'cashier'), ($5, $6, 'owner')`,
    [storeId, ownerId, managerId, cashierId, otherStoreId, otherOwnerId],
  );
});

describe('POST /v1/stores/:storeId/customers', () => {
  it('registers a customer by email, ready for an award', async () => {
    const res = await post(`/v1/stores/${storeId}/customers`, 'cashier@test.dev', {
      email: 'New@Test.dev',
      name: 'Aino Virtanen',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      email: 'new@test.dev',
      firstName: 'Aino',
      balance: 0,
      pending: true,
    });

    const link = await pool.query(
      'SELECT count(*) FROM customer_store_links WHERE store_id = $1',
      [storeId],
    );
    expect(Number(link.rows[0].count)).toBe(1);
  });

  it('returns the same customer when the same email is registered twice', async () => {
    const first = await post(`/v1/stores/${storeId}/customers`, 'cashier@test.dev', {
      email: 'new@test.dev',
    });
    const second = await post(`/v1/stores/${storeId}/customers`, 'owner@test.dev', {
      email: 'NEW@test.dev',
      name: 'Aino',
    });

    expect(second.statusCode).toBe(201);
    expect(second.json().customerId).toBe(first.json().customerId);

    const count = await pool.query('SELECT count(*) FROM customers');
    expect(Number(count.rows[0].count)).toBe(1);
  });

  it('reuses an existing account with that email instead of duplicating it', async () => {
    const existingId = randomUUID();
    await pool.query(
      `INSERT INTO customers (id, email, name, auth_user_id)
       VALUES ($1, 'known@test.dev', 'Known Person', $2)`,
      [existingId, randomUUID()],
    );

    const res = await post(`/v1/stores/${storeId}/customers`, 'cashier@test.dev', {
      email: 'known@test.dev',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ customerId: existingId, pending: false });
  });

  it('never overwrites the name of an existing customer', async () => {
    await post(`/v1/stores/${storeId}/customers`, 'cashier@test.dev', {
      email: 'new@test.dev',
      name: 'The Name They Chose',
    });
    await post(`/v1/stores/${storeId}/customers`, 'cashier@test.dev', {
      email: 'new@test.dev',
      name: 'A Different Name',
    });

    const row = await pool.query("SELECT name FROM customers WHERE email = 'new@test.dev'");
    expect(row.rows[0].name).toBe('The Name They Chose');
  });

  it('refuses a caller who is not staff at this store', async () => {
    const denied = await post(`/v1/stores/${storeId}/customers`, 'other.owner@test.dev', {
      email: 'new@test.dev',
    });
    const anonymous = await post(`/v1/stores/${storeId}/customers`, null, {
      email: 'new@test.dev',
    });

    expect(denied.statusCode).toBe(403);
    expect(anonymous.statusCode).toBe(401);
  });

  it('rejects an address that is not an email', async () => {
    const res = await post(`/v1/stores/${storeId}/customers`, 'cashier@test.dev', {
      email: 'not-an-email',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/stores/:storeId/customers', () => {
  it('lists the store customers with balances and searches by email or name', async () => {
    await post(`/v1/stores/${storeId}/customers`, 'owner@test.dev', {
      email: 'aino@test.dev',
      name: 'Aino Virtanen',
    });
    await post(`/v1/stores/${storeId}/customers`, 'owner@test.dev', {
      email: 'mikko@test.dev',
      name: 'Mikko Mäki',
    });

    const all = await get(`/v1/stores/${storeId}/customers`, 'manager@test.dev');
    expect(all.statusCode).toBe(200);
    expect(all.json().customers).toHaveLength(2);

    const searched = await get(`/v1/stores/${storeId}/customers?query=mikko`, 'owner@test.dev');
    expect(searched.json().customers).toHaveLength(1);
    expect(searched.json().customers[0]).toMatchObject({ name: 'Mikko Mäki', balance: 0 });
  });

  it('refuses a cashier and shows only this store', async () => {
    await post(`/v1/stores/${storeId}/customers`, 'owner@test.dev', { email: 'aino@test.dev' });

    const cashier = await get(`/v1/stores/${storeId}/customers`, 'cashier@test.dev');
    const other = await get(`/v1/stores/${otherStoreId}/customers`, 'owner@test.dev');

    expect(cashier.statusCode).toBe(403);
    expect(other.statusCode).toBe(403);
  });
});

async function customerWithBalance(balance: number): Promise<string> {
  const id = randomUUID();
  await pool.query('INSERT INTO customers (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `${id}@test.dev`,
    'Test Customer',
  ]);
  if (balance !== 0) {
    await pool.query(
      'INSERT INTO points_balances (customer_id, store_id, balance) VALUES ($1, $2, $3)',
      [id, storeId, balance],
    );
  }
  return id;
}

const adjust = (customerId: string, token: string, body: Record<string, unknown>) =>
  post(`/v1/stores/${storeId}/customers/${customerId}/adjustments`, token, body);

describe('POST /v1/stores/:storeId/customers/:customerId/adjustments', () => {
  it('adds and removes points, and refuses to go below zero', async () => {
    const customerId = await customerWithBalance(0);

    const added = await adjust(customerId, 'owner@test.dev', {
      points: 10,
      reason: 'Goodwill for the wait',
    });
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({ balance: 10 });

    const removed = await adjust(customerId, 'manager@test.dev', {
      points: -4,
      reason: 'Corrected a double scan',
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ balance: 6 });

    const tooMuch = await adjust(customerId, 'owner@test.dev', {
      points: -100,
      reason: 'Trying to take too much',
    });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json()).toMatchObject({ error: { code: 'BALANCE_WOULD_GO_NEGATIVE' } });

    const row = await pool.query(
      'SELECT balance FROM points_balances WHERE customer_id = $1 AND store_id = $2',
      [customerId, storeId],
    );
    expect(row.rows[0].balance).toBe(6);
  });

  it('needs a real reason and a non-zero amount', async () => {
    const customerId = await customerWithBalance(5);

    expect((await adjust(customerId, 'owner@test.dev', { points: 5 })).statusCode).toBe(400);
    expect(
      (await adjust(customerId, 'owner@test.dev', { points: 0, reason: 'Nothing at all' })).statusCode,
    ).toBe(400);
    expect(
      (await adjust(customerId, 'owner@test.dev', { points: 1, reason: 'x' })).statusCode,
    ).toBe(400);
  });

  it('refuses a cashier', async () => {
    const customerId = await customerWithBalance(5);
    const res = await adjust(customerId, 'cashier@test.dev', {
      points: 1,
      reason: 'Should not work',
    });
    expect(res.statusCode).toBe(403);
  });

  it('writes an audit entry with the reason and the actor', async () => {
    const customerId = await customerWithBalance(0);
    await adjust(customerId, 'owner@test.dev', { points: 7, reason: 'Service recovery' });

    const audit = await pool.query(
      "SELECT action, reason, target_id, actor_id FROM audit_log_entries WHERE action = 'points.adjust'",
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      action: 'points.adjust',
      reason: 'Service recovery',
      target_id: customerId,
    });
  });
});

const clawback = (customerId: string, token: string, body: Record<string, unknown>) =>
  post(`/v1/admin/stores/${storeId}/customers/${customerId}/clawback`, token, body);

describe('POST /v1/admin/stores/:storeId/customers/:customerId/clawback', () => {
  it('removes points, may go below zero, and marks the link under fraud review', async () => {
    const customerId = await customerWithBalance(3);
    await pool.query(
      'INSERT INTO customer_store_links (customer_id, store_id) VALUES ($1, $2)',
      [customerId, storeId],
    );

    const res = await clawback(customerId, 'admin@test.dev', {
      points: 8,
      caseNote: 'Confirmed case 44: points bought with a stolen card',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ balance: -5 });

    const link = await pool.query(
      'SELECT status FROM customer_store_links WHERE customer_id = $1 AND store_id = $2',
      [customerId, storeId],
    );
    expect(link.rows[0].status).toBe('under_fraud_review');

    const audit = await pool.query(
      "SELECT action, reason FROM audit_log_entries WHERE action = 'points.fraud_clawback'",
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].reason).toContain('Confirmed case 44');
  });

  it('is admin only', async () => {
    const customerId = await customerWithBalance(3);
    const res = await clawback(customerId, 'owner@test.dev', {
      points: 1,
      caseNote: 'Not my decision to make',
    });
    expect(res.statusCode).toBe(403);
  });

  it('requires a case note and a positive number of points', async () => {
    const customerId = await customerWithBalance(3);

    expect((await clawback(customerId, 'admin@test.dev', { points: 1 })).statusCode).toBe(400);
    expect(
      (await clawback(customerId, 'admin@test.dev', { points: -3, caseNote: 'Negative points' }))
        .statusCode,
    ).toBe(400);
  });
});

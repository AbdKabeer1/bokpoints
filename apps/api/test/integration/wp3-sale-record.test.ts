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
      ...(body === undefined ? {} : {}),
      ...(headers ?? {}),
    },
    ...(body === undefined ? {} : { payload: body as object }),
  });
  await app.close();
  return res;
}

const award = (key: string, body: Record<string, unknown>) =>
  inject('POST', `/v1/stores/${storeId}/awards`, 'cashier@test.dev', body, {
    'idempotency-key': key,
  });

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
  await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, 'Sale Store', 'active')", [
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

  // One point per euro, so the maths in the assertions is obvious.
  const rule = await inject('POST', `/v1/stores/${storeId}/rules`, 'owner@test.dev', {
    definition: { type: 'per_euro', pointsPerEuroThousandths: 1000, rounding: 'floor' },
  });
  expect(rule.statusCode).toBe(201);
});

describe('the sale record (WP3)', () => {
  it('records a sale on confirm and links the award to it', async () => {
    const res = await award('sale-1', { customerId, amountCents: 1250 });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.points).toBe(12);
    expect(body.saleId).toMatch(/^[0-9a-f-]{36}$/);

    const sale = await pool.query('SELECT * FROM sales WHERE id = $1', [body.saleId]);
    expect(sale.rows[0]).toMatchObject({
      store_id: storeId,
      customer_id: customerId,
      amount_before_discount_cents: 1250,
      discount_cents: 0,
      amount_paid_cents: 1250,
      status: 'completed',
    });
    expect(Array.isArray(sale.rows[0].rules_applied)).toBe(true);
    expect(sale.rows[0].staff_id).not.toBeNull();

    const entry = await pool.query('SELECT sale_id FROM points_ledger_entries WHERE id = $1', [
      body.entryId,
    ]);
    expect(entry.rows[0].sale_id).toBe(body.saleId);
  });

  it('calculates points on the amount actually paid (D-129)', async () => {
    const res = await award('sale-2', { customerId, amountCents: 1000, amountPaidCents: 400 });
    expect(res.statusCode).toBe(201);
    expect(res.json().points).toBe(4);

    const sale = await pool.query('SELECT * FROM sales WHERE id = $1', [res.json().saleId]);
    expect(sale.rows[0]).toMatchObject({
      amount_before_discount_cents: 1000,
      amount_paid_cents: 400,
    });
  });

  it('refuses an amount paid above the charged amount', async () => {
    const res = await award('sale-3', { customerId, amountCents: 1000, amountPaidCents: 1200 });
    expect(res.statusCode).toBe(400);
  });

  it('a replayed confirm stays one sale', async () => {
    const body = { customerId, amountCents: 900 };
    const first = await award('sale-replay', body);
    const second = await award('sale-replay', body);
    expect(second.json().saleId).toBe(first.json().saleId);

    const sales = await pool.query('SELECT count(*)::int AS n FROM sales WHERE store_id = $1', [
      storeId,
    ]);
    expect(sales.rows[0].n).toBe(1);
  });
});

describe('reversing a sale (D-131)', () => {
  it('returns the points, ties to the sale, and flips its status', async () => {
    const confirmed = await award('rev-1', { customerId, amountCents: 1250 });
    const { entryId, saleId } = confirmed.json();

    const res = await inject(
      'POST',
      `/v1/stores/${storeId}/sales/${saleId}/reversal`,
      'cashier@test.dev',
      { reason: 'customer changed their mind' },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ reversedPoints: -12, balance: 0 });

    const sale = await pool.query('SELECT status FROM sales WHERE id = $1', [saleId]);
    expect(sale.rows[0].status).toBe('reversed');

    const reversal = await pool.query(
      "SELECT * FROM points_ledger_entries WHERE type = 'reversal' AND store_id = $1",
      [storeId],
    );
    expect(reversal.rows).toHaveLength(1);
    expect(reversal.rows[0]).toMatchObject({
      points: -12,
      reversal_of: entryId,
      sale_id: saleId,
      customer_id: customerId,
    });

    const audit = await pool.query(
      "SELECT count(*)::int AS n FROM audit_log_entries WHERE action = 'sale.reversal' AND store_id = $1",
      [storeId],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('refuses to reverse the same sale twice', async () => {
    const confirmed = await award('rev-2', { customerId, amountCents: 500 });
    const { saleId } = confirmed.json();
    await inject('POST', `/v1/stores/${storeId}/sales/${saleId}/reversal`, 'cashier@test.dev', {
      reason: 'customer changed their mind',
    });

    const again = await inject(
      'POST',
      `/v1/stores/${storeId}/sales/${saleId}/reversal`,
      'cashier@test.dev',
      { reason: 'customer changed their mind' },
    );
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({
      error: { code: 'SALE_ALREADY_REVERSED', message: expect.any(String) },
    });
  });

  it('may not drive the balance below zero', async () => {
    const confirmed = await award('rev-3', { customerId, amountCents: 1000 });
    const { saleId } = confirmed.json();

    const owner = await inject(
      'POST',
      `/v1/stores/${storeId}/customers/${customerId}/adjustments`,
      'owner@test.dev',
      { points: -10, reason: 'correcting a mistake first' },
    );
    expect(owner.statusCode).toBe(200);

    const res = await inject(
      'POST',
      `/v1/stores/${storeId}/sales/${saleId}/reversal`,
      'cashier@test.dev',
      { reason: 'customer changed their mind' },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: 'BALANCE_WOULD_GO_NEGATIVE', message: expect.any(String) },
    });

    const sale = await pool.query('SELECT status FROM sales WHERE id = $1', [saleId]);
    expect(sale.rows[0].status).toBe('completed');
  });

  it('answers 404 for an unknown sale and 403 for a stranger', async () => {
    const unknown = await inject(
      'POST',
      `/v1/stores/${storeId}/sales/${randomUUID()}/reversal`,
      'cashier@test.dev',
      { reason: 'customer changed their mind' },
    );
    expect(unknown.statusCode).toBe(404);

    await pool.query(
      "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'stranger@test.dev', 'Stranger', false)",
      [randomUUID()],
    );
    const stranger = await pool.query("SELECT id FROM staff_users WHERE email = 'stranger@test.dev'");
    await pool.query(
      "INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, 'cashier')",
      [storeId, stranger.rows[0].id],
    );
    // A member of ANOTHER store, trying this one.
    const otherStore = randomUUID();
    await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, 'Other', 'active')", [
      otherStore,
    ]);
    const outsider = await inject(
      'POST',
      `/v1/stores/${otherStore}/sales/${randomUUID()}/reversal`,
      'stranger@test.dev',
      { reason: 'customer changed their mind' },
    );
    expect(outsider.statusCode).toBe(403);
  });
});

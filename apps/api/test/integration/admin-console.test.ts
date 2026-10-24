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

const ADMIN = 'admin@test.dev';
const OWNER = 'owner@test.dev';
const CODE = 'CUS-ADMIN-CONSOLE-TEST';

async function inject(
  method: 'GET' | 'POST',
  url: string,
  token: string,
  body?: unknown,
) {
  const app = await buildApp({ db, sessionResolver: createDevSessionResolver(db) });
  const res = await app.inject({
    method,
    url,
    headers: token === '' ? {} : { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { payload: body as object }),
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
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, $2, 'Platform Admin', true)",
    [randomUUID(), ADMIN],
  );
  await pool.query(
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, $2, 'Otto Owner', false)",
    [randomUUID(), OWNER],
  );
  await pool.query(
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'cashier@test.dev', 'Cai Cashier', false)",
    [randomUUID()],
  );
  await pool.query(
    "INSERT INTO stores (id, name, status) VALUES ($1, 'Admin Store', 'active')",
    [storeId],
  );

  const owner = await pool.query("SELECT id FROM staff_users WHERE email = $1", [OWNER]);
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
    `INSERT INTO earning_rules (store_id, type, params, conditions, effective_from, status, version)
     VALUES ($1, 'per_euro', '{"pointsPerEuroThousandths":1000,"rounding":"floor"}', '{}', now() - interval '1 day', 'active', 1)`,
    [storeId],
  );
  await pool.query(
    "INSERT INTO store_rewards (store_id, name, points_cost, active) VALUES ($1, 'Free coffee', 300, true)",
    [storeId],
  );
  await pool.query(
    "INSERT INTO customers (id, email, name, status) VALUES ($1, 'aino@admin.test', 'Aino Admin', 'active')",
    [customerId],
  );
  await pool.query(
    "INSERT INTO customer_store_links (customer_id, store_id) VALUES ($1, $2)",
    [customerId, storeId],
  );
  await pool.query(
    "INSERT INTO points_balances (customer_id, store_id, balance) VALUES ($1, $2, 120)",
    [customerId, storeId],
  );
  await pool.query(
    `INSERT INTO points_ledger_entries (customer_id, store_id, type, points, created_at)
     VALUES ($1, $2, 'earn', 120, now() - interval '2 days')`,
    [customerId, storeId],
  );
  await pool.query(
    "INSERT INTO credentials (customer_id, type, status, identifier) VALUES ($1, 'app_qr', 'active', $2)",
    [customerId, CODE],
  );
});

describe('the admin store list', () => {
  it('lists stores with their numbers, and refuses an owner', async () => {
    const res = await inject('GET', '/v1/admin/stores', ADMIN);
    expect(res.statusCode).toBe(200);
    expect(res.json().stores).toHaveLength(1);
    expect(res.json().stores[0]).toMatchObject({
      storeId,
      name: 'Admin Store',
      status: 'active',
      customers: 1,
    });
    expect(res.json().stores[0].lastActivityAt).toMatch(/^\d{4}-/);

    const refused = await inject('GET', '/v1/admin/stores', OWNER);
    expect(refused.statusCode).toBe(403);
  });

  it('filters by status and name', async () => {
    const byName = await inject('GET', '/v1/admin/stores?query=Admin', ADMIN);
    expect(byName.json().stores).toHaveLength(1);

    const none = await inject('GET', '/v1/admin/stores?query=Nothing', ADMIN);
    expect(none.json().stores).toHaveLength(0);

    const suspended = await inject('GET', '/v1/admin/stores?status=suspended', ADMIN);
    expect(suspended.json().stores).toHaveLength(0);
  });
});

describe('the admin store detail', () => {
  it('reads counts, readiness, staff and recent activity', async () => {
    const res = await inject('GET', `/v1/admin/stores/${storeId}`, ADMIN);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.store).toMatchObject({ storeId, name: 'Admin Store', status: 'active' });
    expect(body.counts).toMatchObject({
      customers: 1,
      activeRules: 1,
      activeRewards: 1,
      awards30d: 1,
      outstandingPoints: 120,
    });
    expect(body.readiness).toMatchObject({ owner: true, rule: true, reward: true });
    expect(body.staff.length).toBeGreaterThan(0);
    expect(Array.isArray(body.recent)).toBe(true);
  });

  it('answers 404 for a store that does not exist', async () => {
    const res = await inject('GET', `/v1/admin/stores/${randomUUID()}`, ADMIN);
    expect(res.statusCode).toBe(404);
  });
});

describe('suspending a store', () => {
  it('changes the status, records the reason and can be undone', async () => {
    const suspended = await inject('POST', `/v1/admin/stores/${storeId}/status`, ADMIN, {
      status: 'suspended',
      reason: 'Failed payment for 30 days',
    });
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json()).toEqual({ storeId, status: 'suspended' });

    const row = await pool.query('SELECT status FROM stores WHERE id = $1', [storeId]);
    expect(row.rows[0].status).toBe('suspended');

    const audit = await pool.query(
      "SELECT reason, before, after FROM audit_log_entries WHERE action = 'store.status'",
    );
    expect(audit.rows[0]).toMatchObject({
      reason: 'Failed payment for 30 days',
      before: { status: 'active' },
      after: { status: 'suspended' },
    });

    const again = await inject('POST', `/v1/admin/stores/${storeId}/status`, ADMIN, {
      status: 'active',
      reason: 'Payment settled',
    });
    expect(again.statusCode).toBe(200);
  });

  it('demands a reason and admin rights', async () => {
    const noReason = await inject('POST', `/v1/admin/stores/${storeId}/status`, ADMIN, {
      status: 'suspended',
      reason: '',
    });
    expect(noReason.statusCode).toBe(400);

    const owner = await inject('POST', `/v1/admin/stores/${storeId}/status`, OWNER, {
      status: 'suspended',
      reason: 'Nope',
    });
    expect(owner.statusCode).toBe(403);
  });
});

describe('support search', () => {
  it('finds a store by name and a customer by code, with balances', async () => {
    const store = await inject('GET', '/v1/admin/support?query=Admin', ADMIN);
    expect(store.statusCode).toBe(200);
    expect(store.json().stores[0]).toMatchObject({ storeId, name: 'Admin Store' });

    const customer = await inject('GET', `/v1/admin/support?query=${CODE}`, ADMIN);
    expect(customer.json().customers[0]).toMatchObject({
      customerId,
      email: 'aino@admin.test',
      balances: [{ storeId, storeName: 'Admin Store', balance: 120 }],
    });

    const byEmail = await inject('GET', '/v1/admin/support?query=aino@admin', ADMIN);
    expect(byEmail.json().customers[0].customerId).toBe(customerId);
  });

  it('is closed to a store owner', async () => {
    const res = await inject('GET', '/v1/admin/support?query=Admin', OWNER);
    expect(res.statusCode).toBe(403);
  });
});

describe('platform analytics and subscriptions', () => {
  it('counts stores, customers and the last thirty days', async () => {
    const res = await inject('GET', '/v1/admin/analytics', ADMIN);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      stores: 1,
      activeStores: 1,
      customers: 1,
      awards30d: 1,
      redemptions30d: 0,
      outstandingPoints: 120,
    });
  });

  it('lists subscriptions, empty until billing is connected', async () => {
    const res = await inject('GET', '/v1/admin/subscriptions', ADMIN);
    expect(res.statusCode).toBe(200);
    expect(res.json().subscriptions).toEqual([]);
  });
});

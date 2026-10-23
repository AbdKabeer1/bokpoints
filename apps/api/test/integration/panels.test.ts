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
  method: 'GET' | 'POST' | 'PATCH',
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
  await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, 'Panel Store', 'active')", [
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
    "INSERT INTO customers (id, email, name, status) VALUES ($1, 'panel@mail.test', 'Pekka Panel', 'active')",
    [customerId],
  );

  const rule = await inject('POST', `/v1/stores/${storeId}/rules`, 'owner@test.dev', {
    definition: { type: 'per_euro', pointsPerEuroThousandths: 1000, rounding: 'floor' },
  });
  expect(rule.statusCode).toBe(201);
});

describe('the store profile panel (D-139)', () => {
  it('the owner reads and updates it; a cashier cannot', async () => {
    const got = await inject('GET', `/v1/stores/${storeId}/profile`, 'owner@test.dev');
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ name: 'Panel Store', brandColor: null });

    const saved = await inject('PATCH', `/v1/stores/${storeId}/profile`, 'owner@test.dev', {
      address: 'Mannerheimintie 1, Helsinki',
      brandColor: '#124b7a',
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ address: 'Mannerheimintie 1, Helsinki', brandColor: '#124b7a' });

    const refused = await inject('PATCH', `/v1/stores/${storeId}/profile`, 'cashier@test.dev', {
      name: 'Hacked',
    });
    expect(refused.statusCode).toBe(403);
  });

  it('a bad colour is refused', async () => {
    const res = await inject('PATCH', `/v1/stores/${storeId}/profile`, 'owner@test.dev', {
      brandColor: 'green',
    });
    expect(res.statusCode).toBe(400);
  });

  it('the change lands in the audit log', async () => {
    await inject('PATCH', `/v1/stores/${storeId}/profile`, 'owner@test.dev', { name: 'Renamed' });
    const audit = await pool.query(
      "SELECT after FROM audit_log_entries WHERE action = 'store.profile'",
    );
    expect(audit.rows[0].after).toMatchObject({ name: 'Renamed' });
  });
});

describe('the branches panel', () => {
  it('the owner adds a branch and lists it; a cashier cannot add', async () => {
    const added = await inject(
      'POST',
      `/v1/stores/${storeId}/branches`,
      'owner@test.dev',
      { name: 'Kamppi' },
    );
    expect(added.statusCode).toBe(201);
    expect(added.json().branches).toHaveLength(1);
    expect(added.json().branches[0]).toMatchObject({ name: 'Kamppi', status: 'active' });

    const refused = await inject(
      'POST',
      `/v1/stores/${storeId}/branches`,
      'cashier@test.dev',
      { name: 'Nope' },
    );
    expect(refused.statusCode).toBe(403);
  });
});

describe('the customer detail panel', () => {
  it('shows the balance and the entries, owners and managers only', async () => {
    await inject('POST', `/v1/stores/${storeId}/awards`, 'cashier@test.dev', {
      customerId,
      amountCents: 1250,
    }, { 'idempotency-key': 'panel-1' });

    const got = await inject(
      'GET',
      `/v1/stores/${storeId}/customers/${customerId}/history`,
      'owner@test.dev',
    );
    expect(got.statusCode).toBe(200);
    expect(got.json().balance).toBe(12);
    expect(got.json().entries).toHaveLength(1);
    expect(got.json().entries[0]).toMatchObject({ type: 'earn', points: 12, amountCents: 1250 });

    const refused = await inject(
      'GET',
      `/v1/stores/${storeId}/customers/${customerId}/history`,
      'cashier@test.dev',
    );
    expect(refused.statusCode).toBe(403);
  });
});

describe('the reports panel', () => {
  it('counts the store’s trade for the last thirty days', async () => {
    await inject('POST', `/v1/stores/${storeId}/awards`, 'cashier@test.dev', {
      customerId,
      amountCents: 1250,
    }, { 'idempotency-key': 'report-1' });

    const got = await inject('GET', `/v1/stores/${storeId}/reports/summary`, 'owner@test.dev');
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({
      customers: 1,
      newCustomers30d: 1,
      pointsIssued30d: 12,
      pointsRedeemed30d: 0,
      pointsExpired30d: 0,
      visits30d: 1,
    });

    // A cashier reads reports too? No — the reports are the owner's panel.
    const refused = await inject(
      'GET',
      `/v1/stores/${storeId}/reports/summary`,
      'cashier@test.dev',
    );
    expect(refused.statusCode).toBe(403);
  });
});

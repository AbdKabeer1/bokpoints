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

const A = 'privacy-a@test.dev';
const B = 'privacy-b@test.dev';

async function appWith(overrides: {
  code?: string;
  deleteAuthUser?: (authUserId: string) => Promise<void>;
} = {}) {
  return buildApp({
    db,
    logger: false,
    customerResolver: createDevCustomerResolver(),
    customerOtpVerifier: async (_email, code) => code === (overrides.code ?? '123456'),
    deleteAuthUser:
      overrides.deleteAuthUser ??
      (async () => {
        /* tests never call Supabase */
      }),
  });
}

async function request(
  method: 'GET' | 'POST',
  url: string,
  token: string,
  body?: Record<string, unknown>,
  overrides: Parameters<typeof appWith>[0] = {},
) {
  const app = await appWith(overrides);
  const headers = { authorization: `Bearer ${token}` };
  const res =
    body === undefined
      ? await app.inject({ method, url, headers })
      : await app.inject({ method, url, headers, payload: body });
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

describe('customer privacy (A5)', () => {
  it('exports only the caller’s own profile, consents, balances and ledger', async () => {
    const meA = await request('GET', '/v1/customer/me', A);
    const meB = await request('GET', '/v1/customer/me', B);
    const idA = meA.json().customer.id as string;
    const idB = meB.json().customer.id as string;

    const storeA = randomUUID();
    const storeB = randomUUID();
    await pool.query(
      "INSERT INTO stores (id, name, status) VALUES ($1, 'Store A', 'active'), ($2, 'Store B', 'active')",
      [storeA, storeB],
    );
    await pool.query(
      'INSERT INTO customer_store_links (customer_id, store_id, marketing_consent) VALUES ($1, $2, true), ($3, $4, false)',
      [idA, storeA, idB, storeB],
    );
    await pool.query(
      'INSERT INTO points_balances (customer_id, store_id, balance) VALUES ($1, $2, 11), ($3, $4, 22)',
      [idA, storeA, idB, storeB],
    );
    await pool.query(
      `INSERT INTO points_ledger_entries (customer_id, store_id, type, points)
       VALUES ($1, $2, 'earn', 11), ($3, $4, 'earn', 22)`,
      [idA, storeA, idB, storeB],
    );

    const exportA = await request('GET', '/v1/customer/me/export', A);
    expect(exportA.statusCode).toBe(200);
    expect(exportA.json().profile.email).toBe(A);
    expect(exportA.json().balances).toEqual([
      { storeId: storeA, storeName: 'Store A', points: 11 },
    ]);
    expect(exportA.json().ledger).toHaveLength(1);
    expect(exportA.json().ledger[0].storeId).toBe(storeA);
    expect(exportA.json().ledger[0].points).toBe(11);
    expect(JSON.stringify(exportA.json())).not.toContain(B);

    const exportB = await request('GET', '/v1/customer/me/export', B);
    expect(exportB.statusCode).toBe(200);
    expect(exportB.json().profile.email).toBe(B);
    expect(exportB.json().balances).toEqual([
      { storeId: storeB, storeName: 'Store B', points: 22 },
    ]);
    expect(JSON.stringify(exportB.json())).not.toContain(A);
  });

  it('anonymises the customer, revokes credentials and keeps the ledger', async () => {
    const me = await request('GET', '/v1/customer/me', A);
    const customerId = me.json().customer.id as string;
    const storeId = randomUUID();

    await pool.query(
      "INSERT INTO stores (id, name, status) VALUES ($1, 'Store A', 'active')",
      [storeId],
    );
    await pool.query(
      'INSERT INTO customer_store_links (customer_id, store_id) VALUES ($1, $2)',
      [customerId, storeId],
    );
    await pool.query(
      'INSERT INTO points_ledger_entries (customer_id, store_id, type, points) VALUES ($1, $2, $3, $4)',
      [customerId, storeId, 'earn', 7],
    );
    await pool.query(
      'INSERT INTO points_balances (customer_id, store_id, balance) VALUES ($1, $2, 7)',
      [customerId, storeId],
    );

    const deleted = await request('POST', '/v1/customer/me/delete', A, { code: '123456' });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });

    const customer = await pool.query('SELECT * FROM customers WHERE id = $1', [customerId]);
    expect(customer.rows[0]).toMatchObject({
      status: 'deleted',
      name: '',
      phone: null,
      auth_user_id: null,
    });
    expect(customer.rows[0].email).toMatch(/^deleted\+/);
    expect(customer.rows[0].email).not.toContain(A);

    const credentials = await pool.query(
      'SELECT status FROM credentials WHERE customer_id = $1',
      [customerId],
    );
    expect(credentials.rows.every((row) => row.status === 'revoked')).toBe(true);

    const ledger = await pool.query(
      'SELECT count(*)::int AS count FROM points_ledger_entries WHERE customer_id = $1',
      [customerId],
    );
    expect(ledger.rows[0].count).toBe(1);

    const links = await pool.query(
      'SELECT count(*)::int AS count FROM customer_store_links WHERE customer_id = $1',
      [customerId],
    );
    expect(links.rows[0].count).toBe(0);

    // The same email can start again as a fresh customer.
    const again = await request('GET', '/v1/customer/me', A);
    expect(again.statusCode).toBe(200);
    expect(again.json().customer.id).not.toBe(customerId);
    expect(again.json().customer.email).toBe(A);
  });

  it('refuses deletion with a wrong code and changes nothing', async () => {
    const me = await request('GET', '/v1/customer/me', A);
    const customerId = me.json().customer.id as string;

    const refused = await request('POST', '/v1/customer/me/delete', A, { code: '000000' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('CODE_INVALID');

    const customer = await pool.query('SELECT status, email FROM customers WHERE id = $1', [
      customerId,
    ]);
    expect(customer.rows[0]).toEqual({ status: 'active', email: A });
  });

  it('keeps auth_user_id when Auth deletion fails so the old token stays blocked', async () => {
    const me = await request('GET', '/v1/customer/me', A);
    const customerId = me.json().customer.id as string;

    const deleted = await request('POST', '/v1/customer/me/delete', A, { code: '123456' }, {
      deleteAuthUser: async () => {
        throw new Error('Supabase unavailable');
      },
    });
    expect(deleted.statusCode).toBe(200);

    const customer = await pool.query('SELECT status, auth_user_id FROM customers WHERE id = $1', [
      customerId,
    ]);
    expect(customer.rows[0].status).toBe('deleted');
    expect(customer.rows[0].auth_user_id).not.toBeNull();

    const oldToken = await request('GET', '/v1/customer/me', A);
    expect(oldToken.statusCode).toBe(403);
    expect(oldToken.json().error.code).toBe('ACCOUNT_DELETED');
  });

  it('lets a platform admin anonymise a customer and audits it', async () => {
    const me = await request('GET', '/v1/customer/me', A);
    const customerId = me.json().customer.id as string;
    const adminId = randomUUID();
    await pool.query(
      "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'admin@test.dev', 'Admin', true)",
      [adminId],
    );

    const app = await buildApp({
      db,
      logger: false,
      customerResolver: createDevCustomerResolver(),
      sessionResolver: createDevSessionResolver(db),
      deleteAuthUser: async () => {
        /* no Supabase in tests */
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/customers/${customerId}/anonymise`,
      headers: { authorization: 'Bearer admin@test.dev' },
      payload: { reason: 'Customer asked us to erase the account', confirmation: 'ANONYMISE' },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ customerId, deleted: true });

    const audit = await pool.query(
      'SELECT action, actor_role, target_type, target_id, reason FROM audit_log_entries WHERE target_id = $1',
      [customerId],
    );
    expect(audit.rows[0]).toMatchObject({
      action: 'customer.anonymise',
      actor_role: 'admin',
      target_type: 'customer',
      target_id: customerId,
      reason: 'Customer asked us to erase the account',
    });
  });
});

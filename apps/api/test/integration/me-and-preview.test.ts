import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { expiryDateForEarn } from '@bokpoints/shared';
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
let kamppiId: string;
let tooeloeId: string;
let customerId: string;

async function staffUser(
  email: string,
  options: { isAdmin?: boolean; status?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO staff_users (id, email, name, is_admin, status) VALUES ($1, $2, $3, $4, $5)',
    [id, email, email, options.isAdmin ?? false, options.status ?? 'active'],
  );
  return id;
}

const inject = async (
  method: 'GET' | 'POST',
  url: string,
  token: string | null,
  payload?: Record<string, unknown>,
) => {
  const app = await buildApp({ db, sessionResolver: createDevSessionResolver(db) });
  const res = await app.inject({
    method,
    url,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload }),
  });
  await app.close();
  return res;
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

  await staffUser('admin@test.dev', { isAdmin: true });
  const ownerId = await staffUser('owner@test.dev');
  const limitedCashierId = await staffUser('cashier@test.dev');
  const otherOwnerId = await staffUser('other.owner@test.dev');

  await pool.query(
    `INSERT INTO stores (id, name, status)
     VALUES ($1, 'Kahvila Test', 'active'), ($2, 'Other Shop', 'active')`,
    [storeId, otherStoreId],
  );
  await pool.query(
    `INSERT INTO points_rules (store_id, rule_version, points_per_euro_thousandths, rounding, min_purchase_cents, active_from)
     SELECT id, 1, 1000, 'floor', 500, now() FROM stores`,
  );

  kamppiId = randomUUID();
  tooeloeId = randomUUID();
  const otherBranchId = randomUUID();
  await pool.query(
    `INSERT INTO store_locations (id, store_id, name, status)
     VALUES ($1, $2, 'Kamppi', 'active'), ($3, $2, 'Töölö', 'active'), ($4, $5, 'Itäkeskus', 'active')`,
    [kamppiId, storeId, tooeloeId, otherBranchId, otherStoreId],
  );

  await pool.query(
    `INSERT INTO store_members (store_id, user_id, role, location_id)
     VALUES ($1, $2, 'owner', NULL), ($1, $3, 'cashier', $4), ($5, $6, 'owner', NULL)`,
    [storeId, ownerId, limitedCashierId, kamppiId, otherStoreId, otherOwnerId],
  );

  await pool.query(
    `INSERT INTO customers (id, email, name) VALUES ($1, 'aino@test.dev', 'Aino Virtanen')`,
    [customerId],
  );
});

const preview = (token: string, payload: Record<string, unknown>) =>
  inject('POST', `/v1/stores/${storeId}/awards/preview`, token, payload);

describe('GET /v1/me', () => {
  it('tells an owner who they are and which store they run', async () => {
    const res = await inject('GET', '/v1/me', 'owner@test.dev');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      staff: { email: 'owner@test.dev', isAdmin: false },
      memberships: [
        {
          storeId,
          storeName: 'Kahvila Test',
          role: 'owner',
          locationId: null,
          locationName: null,
          status: 'active',
          branches: [
            { id: kamppiId, name: 'Kamppi' },
            { id: tooeloeId, name: 'Töölö' },
          ],
        },
      ],
    });
  });

  it('shows a branch-limited cashier their branch', async () => {
    const res = await inject('GET', '/v1/me', 'cashier@test.dev');
    expect(res.statusCode).toBe(200);
    expect(res.json().memberships).toHaveLength(1);
    expect(res.json().memberships[0]).toMatchObject({
      role: 'cashier',
      locationId: kamppiId,
      locationName: 'Kamppi',
    });
  });

  it('gives an admin an empty list until they are invited somewhere', async () => {
    const res = await inject('GET', '/v1/me', 'admin@test.dev');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ staff: { isAdmin: true }, memberships: [] });
  });

  it('refuses a deactivated account', async () => {
    await staffUser('gone@test.dev', { status: 'deactivated' });
    const res = await inject('GET', '/v1/me', 'gone@test.dev');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'ACCOUNT_DEACTIVATED' } });
  });

  it('needs a token at all', async () => {
    const res = await inject('GET', '/v1/me', null);
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/stores/:storeId/awards/preview', () => {
  it('shows what a purchase earns and when it expires, without writing', async () => {
    const expectedExpiry = expiryDateForEarn(new Date()).toISOString().slice(0, 10);

    const res = await preview('owner@test.dev', {
      customerId,
      amountCents: 2500,
      locationId: kamppiId,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      customerId,
      points: 25,
      awarded: true,
      expiresAt: expectedExpiry,
      locationId: kamppiId,
      locationName: 'Kamppi',
      redeemed: null,
      discountCents: 0,
      breakdown: [
        {
          ruleId: expect.any(String),
          type: 'per_euro',
          version: 1,
          points: 25,
          applied: true,
        },
      ],
    });

    const entries = await pool.query('SELECT count(*) FROM points_ledger_entries');
    const batches = await pool.query('SELECT count(*) FROM points_batches');
    expect(Number(entries.rows[0].count)).toBe(0);
    expect(Number(batches.rows[0].count)).toBe(0);
  });

  it('calls a below-minimum purchase a normal refusal, not an error', async () => {
    const res = await preview('owner@test.dev', {
      customerId,
      amountCents: 400,
      locationId: kamppiId,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      points: 0,
      awarded: false,
      reason: 'below_minimum',
      expiresAt: null,
    });
  });

  it('uses the branch of a limited cashier without being told', async () => {
    const res = await preview('cashier@test.dev', { customerId, amountCents: 1000 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ points: 10, locationId: kamppiId, locationName: 'Kamppi' });
  });

  it('refuses a store the caller does not work at', async () => {
    const res = await preview('other.owner@test.dev', {
      customerId,
      amountCents: 2500,
      locationId: kamppiId,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'STORE_MISMATCH' } });
  });

  it('refuses a store that is not awarding', async () => {
    await pool.query("UPDATE stores SET status = 'suspended' WHERE id = $1", [storeId]);
    const res = await preview('owner@test.dev', {
      customerId,
      amountCents: 2500,
      locationId: kamppiId,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'STORE_NOT_AWARDING' } });
  });

  it('refuses an unknown customer', async () => {
    const res = await preview('owner@test.dev', {
      customerId: randomUUID(),
      amountCents: 2500,
      locationId: kamppiId,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'CUSTOMER_NOT_FOUND' } });
  });
});

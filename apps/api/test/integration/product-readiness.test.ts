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

const CUSTOMER = 'feedback@test.dev';
const OWNER = 'owner-feedback@test.dev';
const ADMIN = 'admin-feedback@test.dev';

async function app() {
  return buildApp({
    db,
    logger: false,
    customerResolver: createDevCustomerResolver(),
    sessionResolver: createDevSessionResolver(db),
  });
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

describe('product readiness', () => {
  it('stores the global notification preference and customer feedback', async () => {
    const instance = await app();

    const me = await instance.inject({
      method: 'GET',
      url: '/v1/customer/me',
      headers: { authorization: `Bearer ${CUSTOMER}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().customer.notificationsEnabled).toBe(true);

    const patched = await instance.inject({
      method: 'PATCH',
      url: '/v1/customer/me',
      headers: { authorization: `Bearer ${CUSTOMER}` },
      payload: { notificationsEnabled: false },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().customer.notificationsEnabled).toBe(false);

    const feedback = await instance.inject({
      method: 'POST',
      url: '/v1/customer/me/feedback',
      headers: { authorization: `Bearer ${CUSTOMER}` },
      payload: { category: 'idea', message: 'Please add a dark mode' },
    });
    expect(feedback.statusCode).toBe(201);
    expect(feedback.json().id).toMatch(/^[0-9a-f-]{36}$/);

    const row = await pool.query('SELECT source, category, message, contact_email FROM feedback');
    expect(row.rows[0]).toMatchObject({
      source: 'customer',
      category: 'idea',
      message: 'Please add a dark mode',
      contact_email: CUSTOMER,
    });

    await instance.close();
  });

  it('accepts staff and admin feedback and lists it for the admin', async () => {
    await pool.query(
      "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, $2, 'Owner', false), ($3, $4, 'Admin', true)",
      [randomUUID(), OWNER, randomUUID(), ADMIN],
    );

    const instance = await app();

    const owner = await instance.inject({
      method: 'POST',
      url: '/v1/me/feedback',
      headers: { authorization: `Bearer ${OWNER}` },
      payload: { category: 'bug', message: 'The reward list scrolled oddly', page: 'Rewards' },
    });
    expect(owner.statusCode).toBe(201);

    const admin = await instance.inject({
      method: 'POST',
      url: '/v1/admin/feedback',
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { category: 'other', message: 'Support queue looks right' },
    });
    expect(admin.statusCode).toBe(201);

    const list = await instance.inject({
      method: 'GET',
      url: '/v1/admin/feedback',
      headers: { authorization: `Bearer ${ADMIN}` },
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json().feedback as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.source)).toEqual(['admin', 'owner']);
    expect(rows[1]).toMatchObject({ category: 'bug', page: 'Rewards' });

    await instance.close();
  });
});

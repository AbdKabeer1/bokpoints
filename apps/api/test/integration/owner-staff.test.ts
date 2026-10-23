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

async function inject(method: 'GET', url: string, token: string) {
  const app = await buildApp({ db, sessionResolver: createDevSessionResolver(db) });
  const res = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
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

  await pool.query(
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'owner@test.dev', 'Orla Owner', false)",
    [randomUUID()],
  );
  await pool.query(
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'cashier@test.dev', 'Kai Cashier', false)",
    [randomUUID()],
  );
  await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, 'People Store', 'active')", [
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
});

describe('the store staff list (owner portal)', () => {
  it('lists members with their roles, for the people page', async () => {
    const res = await inject('GET', `/v1/stores/${storeId}/staff`, 'owner@test.dev');
    expect(res.statusCode).toBe(200);
    const members = res.json().members;
    expect(members).toHaveLength(2);
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: 'owner@test.dev', role: 'owner', status: 'active' }),
        expect.objectContaining({ email: 'cashier@test.dev', role: 'cashier', status: 'active' }),
      ]),
    );
    expect(members[0]).toHaveProperty('memberId');
  });

  it('refuses a cashier who wants the people page', async () => {
    const res = await inject('GET', `/v1/stores/${storeId}/staff`, 'cashier@test.dev');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: 'FORBIDDEN', message: expect.any(String) } });
  });

  it('refuses a member of another store', async () => {
    const otherStore = randomUUID();
    await pool.query(
      "INSERT INTO stores (id, name, status) VALUES ($1, 'Elsewhere', 'active')",
      [otherStore],
    );
    const res = await inject('GET', `/v1/stores/${otherStore}/staff`, 'owner@test.dev');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'STORE_MISMATCH', message: expect.any(String) },
    });
  });
});

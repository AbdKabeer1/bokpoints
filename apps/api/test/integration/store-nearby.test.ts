import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDevSessionResolver, createDevCustomerResolver } from '../../src/auth/dev-session.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { applyMigrations, truncateAll } from './setup.js';
import { stores } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

let pool: ReturnType<typeof createPool>;
let db: Database;

async function inject(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  token: string,
  body?: object,
) {
  const app = await buildApp({ db, sessionResolver: createDevSessionResolver(db) });
  const res = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { payload: body }),
  });
  await app.close();
  return res;
}

async function injectCustomer(method: 'GET' | 'POST' | 'PATCH', url: string, token: string) {
  const app = await buildApp({ db, customerResolver: createDevCustomerResolver() });
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
});

describe('store nearby', () => {
  it('stores coordinates when the owner saves an address', async () => {
    const storeId = randomUUID();
    const staffId = randomUUID();
    const ownerEmail = 'owner@test.dev';

    await pool.query(
      `INSERT INTO stores (id, name, status, brand_color) VALUES ($1, $2, $3, $4)`,
      [storeId, 'Test Store', 'active', '#112233']
    );
    await pool.query(
      `INSERT INTO staff_users (id, email, name) VALUES ($1, $2, $3)`,
      [staffId, ownerEmail, 'Owner']
    );
    const storeMembersId = randomUUID();
    await pool.query(
      `INSERT INTO store_members (id, store_id, user_id, role, status) VALUES ($1, $2, $3, $4, $5)`,
      [storeMembersId, storeId, staffId, 'owner', 'active']
    );

    const getRes = await inject('GET', `/v1/stores/${storeId}/profile`, ownerEmail);
    if (getRes.statusCode !== 200) {
      console.log('GET ERROR', getRes.statusCode, getRes.payload);
    }
    expect(getRes.statusCode).toBe(200);

    const res = await inject(
      'PATCH',
      `/v1/stores/${storeId}/profile`,
      ownerEmail,
      { address: 'Mannerheimintie 10, Helsinki' }
    );

    // Debug
    if (res.statusCode !== 200) {
      // @ts-ignore
      console.log('ERROR', res.statusCode, res.payload);
    }

    expect(res.statusCode).toBe(200);

    const row = await db.select()
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);

    // For now this will be null until geocoding is implemented
    expect(row[0]?.latitude).not.toBeNull();
    expect(row[0]?.longitude).not.toBeNull();
  });

  it('sorts the directory by distance when the caller sends coordinates', async () => {
    const customerEmail = 'customer@test.dev';
    const nearStoreId = randomUUID();
    const farStoreId = randomUUID();

    await pool.query(
      `INSERT INTO customers (id, email, name, status) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), customerEmail, 'Test Customer', 'active']
    );

    // Near store
    await pool.query(
      `INSERT INTO stores (id, name, status, latitude, longitude) VALUES ($1, $2, $3, $4, $5)`,
      [nearStoreId, 'Near Store', 'active', 60.17, 24.94]
    );
    // Far store
    await pool.query(
      `INSERT INTO stores (id, name, status, latitude, longitude) VALUES ($1, $2, $3, $4, $5)`,
      [farStoreId, 'Far Store', 'active', 60.5, 25.0]
    );

    const res = await injectCustomer('GET', `/v1/customer/stores?lat=60.17&lon=24.94`, customerEmail);
    expect(res.statusCode).toBe(200);
    const storesList = (res.json() as any).stores;
    expect(storesList[0].name).toBe('Near Store');
    expect(Number(storesList[0].distanceKm)).toBeLessThan(1);
    expect(storesList[1].name).toBe('Far Store');
    expect(Number(storesList[1].distanceKm)).toBeGreaterThan(20);
  });

  it('keeps alphabetical order without coordinates', async () => {
    const customerEmail = 'customer2@test.dev';
    await pool.query(
      `INSERT INTO customers (id, email, name, status) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), customerEmail, 'Test Customer 2', 'active']
    );
    await pool.query(
      `INSERT INTO stores (id, name, status) VALUES ($1, $2, $3)`,
      [randomUUID(), 'Beta Store', 'active']
    );
    await pool.query(
      `INSERT INTO stores (id, name, status) VALUES ($1, $2, $3)`,
      [randomUUID(), 'Alpha Store', 'active']
    );

    const res = await injectCustomer('GET', `/v1/customer/stores`, customerEmail);
    expect(res.statusCode).toBe(200);
    const storesList = (res.json() as any).stores;
    expect(storesList[0].name).toBe('Alpha Store');
    expect(storesList[0].distanceKm).toBeNull();
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDevSessionResolver } from '../../src/auth/dev-session.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import type { LogoStore } from '../../src/db/logo-storage.js';
import { applyMigrations, truncateAll } from './setup.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01,
]);

let pool: ReturnType<typeof createPool>;
let db: Database;
let storeId: string;
let logoStore: { put: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

async function inject(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, body?: unknown) {
  const app = await buildApp({
    db,
    sessionResolver: createDevSessionResolver(db),
    logoStore: logoStore as unknown as LogoStore,
  });
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
  logoStore = {
    put: vi.fn(async (id: string) => `https://cdn.example.test/${id}.png?v=1`),
    remove: vi.fn(async () => undefined),
  };

  storeId = randomUUID();
  await pool.query(
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'owner@test.dev', 'Otto', false)",
    [randomUUID()],
  );
  await pool.query(
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'cashier@test.dev', 'Cai', false)",
    [randomUUID()],
  );
  await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, 'Logo Store', 'active')", [
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

describe('store logo', () => {
  it('uploads a real PNG, stores the URL and records the change', async () => {
    const res = await inject('POST', `/v1/stores/${storeId}/logo`, 'owner@test.dev', {
      contentType: 'image/png',
      data: PNG.toString('base64'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().logoUrl).toContain('cdn.example.test');
    expect(logoStore.put).toHaveBeenCalledOnce();

    const row = await pool.query('SELECT logo_url FROM stores WHERE id = $1', [storeId]);
    expect(row.rows[0].logo_url).toContain('cdn.example.test');

    const audit = await pool.query(
      "SELECT after FROM audit_log_entries WHERE action = 'store.logo'",
    );
    expect(audit.rows[0].after.logoUrl).toContain('cdn.example.test');

    const profile = await inject('GET', `/v1/stores/${storeId}/profile`, 'owner@test.dev');
    expect(profile.json().logoUrl).toContain('cdn.example.test');
  });

  it('removes the logo and clears the URL', async () => {
    await inject('POST', `/v1/stores/${storeId}/logo`, 'owner@test.dev', {
      contentType: 'image/png',
      data: PNG.toString('base64'),
    });

    const res = await inject('DELETE', `/v1/stores/${storeId}/logo`, 'owner@test.dev');
    expect(res.statusCode).toBe(200);
    expect(res.json().logoUrl).toBeNull();
    expect(logoStore.remove).toHaveBeenCalledOnce();

    const row = await pool.query('SELECT logo_url FROM stores WHERE id = $1', [storeId]);
    expect(row.rows[0].logo_url).toBeNull();
  });

  it('refuses a mislabelled file and a cashier', async () => {
    const mislabelled = await inject('POST', `/v1/stores/${storeId}/logo`, 'owner@test.dev', {
      contentType: 'image/jpeg',
      data: PNG.toString('base64'),
    });
    expect(mislabelled.statusCode).toBe(400);
    expect(mislabelled.json().error.code).toBe('LOGO_TYPE');

    const refused = await inject('POST', `/v1/stores/${storeId}/logo`, 'cashier@test.dev', {
      contentType: 'image/png',
      data: PNG.toString('base64'),
    });
    expect(refused.statusCode).toBe(403);
  });

  it('refuses an image over 2 MB', async () => {
    const oversized = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    const res = await inject('POST', `/v1/stores/${storeId}/logo`, 'owner@test.dev', {
      contentType: 'image/png',
      data: oversized.toString('base64'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('LOGO_TOO_LARGE');
  });

  it('answers 503 when storage is not configured', async () => {
    const app = await buildApp({
      db,
      sessionResolver: createDevSessionResolver(db),
      logoStore: null,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeId}/logo`,
      headers: { authorization: 'Bearer owner@test.dev' },
      payload: { contentType: 'image/png', data: PNG.toString('base64') },
    });
    await app.close();
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('LOGO_STORAGE_UNAVAILABLE');
  });
});

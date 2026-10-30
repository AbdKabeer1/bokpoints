import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { applyMigrations, truncateAll } from './setup.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

let pool: ReturnType<typeof createPool>;
let db: Database;

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

describe('development admin token route', () => {
  it('is absent unless explicitly enabled', async () => {
    const app = await buildApp({ db });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/dev-token',
      payload: { email: 'dev@example.test' },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it.each([
    { label: 'missing email', payload: {} },
    { label: 'invalid email', payload: { email: 'not-an-email' } },
    { label: 'unknown field', payload: { email: 'dev@example.test', isAdmin: true } },
  ])('rejects $label', async ({ payload }) => {
    const app = await buildApp({ db, enableDevAdminToken: true });
    const response = await app.inject({ method: 'POST', url: '/v1/admin/dev-token', payload });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('normalizes a valid email and creates a platform admin', async () => {
    const app = await buildApp({ db, enableDevAdminToken: true });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/dev-token',
      payload: { email: ' Dev.Admin@Example.test ' },
    });

    expect(response.statusCode, response.payload).toBe(200);
    expect(response.json()).toMatchObject({ token: 'dev.admin@example.test' });
    const result = await pool.query(
      'SELECT email, is_admin FROM staff_users WHERE lower(email) = $1',
      ['dev.admin@example.test'],
    );
    expect(result.rows).toEqual([{ email: 'dev.admin@example.test', is_admin: true }]);
    await app.close();
  });
});

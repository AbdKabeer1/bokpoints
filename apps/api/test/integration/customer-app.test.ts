import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDevCustomerResolver, uuidFromEmail } from '../../src/auth/dev-session.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { applyMigrations, truncateAll } from './setup.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

let pool: ReturnType<typeof createPool>;
let db: Database;

type Method = 'GET' | 'PATCH';

async function inject(
  method: Method,
  url: string,
  token: string | null,
  payload?: Record<string, unknown>,
) {
  const app = await buildApp({ db, customerResolver: createDevCustomerResolver() });
  const res = await app.inject({
    method,
    url,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload }),
  });
  await app.close();
  return res;
}

const get = (url: string, token: string | null) => inject('GET', url, token);
const patch = (url: string, token: string | null, payload: Record<string, unknown>) =>
  inject('PATCH', url, token, payload);

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

describe('GET /v1/customer/me', () => {
  it('provisions exactly one customer and one credential on the first call', async () => {
    const first = await get('/v1/customer/me', 'new@test.dev');
    const second = await get('/v1/customer/me', 'new@test.dev');

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const body = first.json();
    expect(body.customer.email).toBe('new@test.dev');
    expect(body.credential.type).toBe('app_qr');
    expect(body.credential.identifier).toMatch(/^CUS-[A-Z2-7]{26}$/);
    expect(body.onboardingComplete).toBe(false);

    expect(second.json().customer.id).toBe(body.customer.id);
    expect(second.json().credential.identifier).toBe(body.credential.identifier);

    const customers = await pool.query('SELECT count(*) FROM customers');
    const credentials = await pool.query('SELECT count(*) FROM credentials');
    expect(Number(customers.rows[0].count)).toBe(1);
    expect(Number(credentials.rows[0].count)).toBe(1);
  });

  it('claims an existing unlinked customer row with the same email', async () => {
    const existingId = randomUUID();
    await pool.query(
      "INSERT INTO customers (id, email, name) VALUES ($1, 'known@test.dev', 'Aino')",
      [existingId],
    );

    const res = await get('/v1/customer/me', 'Known@Test.dev');

    expect(res.statusCode).toBe(200);
    expect(res.json().customer.id).toBe(existingId);
    expect(res.json().customer.name).toBe('Aino');
    expect(res.json().onboardingComplete).toBe(true);

    const row = await pool.query('SELECT auth_user_id FROM customers WHERE id = $1', [existingId]);
    expect(row.rows[0].auth_user_id).toBe(uuidFromEmail('known@test.dev'));
  });

  it('refuses to take over a row already linked to another auth user', async () => {
    await pool.query(
      `INSERT INTO customers (id, email, name, auth_user_id)
       VALUES ($1, 'taken@test.dev', 'Someone', $2)`,
      [randomUUID(), randomUUID()],
    );

    const res = await get('/v1/customer/me', 'taken@test.dev');

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'EMAIL_ALREADY_LINKED' } });
  });

  it('refuses a deleted customer', async () => {
    await pool.query(
      `INSERT INTO customers (id, email, name, status, auth_user_id)
       VALUES ($1, 'gone@test.dev', 'Gone', 'deleted', $2)`,
      [randomUUID(), uuidFromEmail('gone@test.dev')],
    );

    const res = await get('/v1/customer/me', 'gone@test.dev');

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'ACCOUNT_DELETED' } });
  });

  it('needs a token at all', async () => {
    const res = await get('/v1/customer/me', null);
    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /v1/customer/me', () => {
  it('saves a trimmed name and a language, and flips onboardingComplete', async () => {
    await get('/v1/customer/me', 'new@test.dev');

    const res = await patch('/v1/customer/me', 'new@test.dev', {
      name: '  Aino  ',
      language: 'en',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().customer.name).toBe('Aino');
    expect(res.json().customer.language).toBe('en');
    expect(res.json().onboardingComplete).toBe(true);
  });

  it('rejects an empty name, an unknown language and an empty body', async () => {
    await get('/v1/customer/me', 'new@test.dev');

    expect((await patch('/v1/customer/me', 'new@test.dev', { name: '   ' })).statusCode).toBe(400);
    expect((await patch('/v1/customer/me', 'new@test.dev', { language: 'de' })).statusCode).toBe(
      400,
    );
    expect((await patch('/v1/customer/me', 'new@test.dev', {})).statusCode).toBe(400);
  });

  it('keeps the same credential across profile changes', async () => {
    const first = await get('/v1/customer/me', 'new@test.dev');
    const after = await patch('/v1/customer/me', 'new@test.dev', { name: 'Aino' });

    expect(after.json().credential.identifier).toBe(first.json().credential.identifier);
  });
});

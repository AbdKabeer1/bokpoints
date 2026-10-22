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

async function makeCustomer(email: string): Promise<string> {
  const res = await get('/v1/customer/me', email);
  return res.json().customer.id as string;
}

async function makeStore(name: string): Promise<string> {
  const id = randomUUID();
  await pool.query('INSERT INTO stores (id, name, status) VALUES ($1, $2, $3)', [
    id,
    name,
    'active',
  ]);
  return id;
}

async function addEntry(
  customerId: string,
  storeId: string,
  type: 'earn' | 'adjust' | 'expire',
  points: number,
  at: string,
): Promise<string> {
  const inserted = await pool.query(
    `INSERT INTO points_ledger_entries (customer_id, store_id, type, points, created_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [customerId, storeId, type, points, at],
  );
  await pool.query(
    `INSERT INTO points_balances (customer_id, store_id, balance)
     VALUES ($1, $2, $3)
     ON CONFLICT (customer_id, store_id)
     DO UPDATE SET balance = points_balances.balance + EXCLUDED.balance, updated_at = now()`,
    [customerId, storeId, points],
  );

  return inserted.rows[0].id as string;
}

async function addBatch(
  customerId: string,
  storeId: string,
  points: number,
  expiresAt: string,
): Promise<void> {
  const entryId = await addEntry(customerId, storeId, 'earn', points, '2026-10-01T10:00:00Z');
  await pool.query(
    `INSERT INTO points_batches
       (earn_entry_id, customer_id, store_id, original_points, remaining_points, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entryId, customerId, storeId, points, points, expiresAt],
  );
}

describe('GET /v1/customer/me/stores', () => {
  it('lists only stores with activity, newest first, with the live balance', async () => {
    const customerId = await makeCustomer('new@test.dev');
    const storeA = await makeStore('Kahvila A');
    const storeB = await makeStore('Kahvila B');

    await addEntry(customerId, storeA, 'earn', 25, '2026-10-20T10:00:00Z');
    await addEntry(customerId, storeB, 'earn', 10, '2026-10-21T10:00:00Z');
    await addEntry(customerId, storeA, 'expire', -25, '2026-10-22T10:00:00Z');

    const res = await get('/v1/customer/me/stores', 'new@test.dev');

    expect(res.statusCode).toBe(200);
    const stores = res.json().stores as Array<Record<string, unknown>>;
    expect(stores.map((store) => store.name)).toEqual(['Kahvila A', 'Kahvila B']);
    expect(stores[0]).toMatchObject({ balance: 0 });
    expect(stores[1]).toMatchObject({ balance: 10 });
    expect(typeof stores[0]?.lastActivityAt).toBe('string');
  });

  it('is empty for a customer with no activity', async () => {
    const res = await get('/v1/customer/me/stores', 'fresh@test.dev');
    expect(res.statusCode).toBe(200);
    expect(res.json().stores).toEqual([]);
  });
});

describe('GET /v1/customer/me/stores/:storeId/history', () => {
  it('returns the true running balance, newest first', async () => {
    const customerId = await makeCustomer('new@test.dev');
    const storeId = await makeStore('Kahvila A');

    await addEntry(customerId, storeId, 'earn', 25, '2026-10-20T10:00:00Z');
    await addEntry(customerId, storeId, 'adjust', -10, '2026-10-21T10:00:00Z');
    await addEntry(customerId, storeId, 'earn', 5, '2026-10-22T10:00:00Z');

    const res = await get(`/v1/customer/me/stores/${storeId}/history`, 'new@test.dev');

    expect(res.statusCode).toBe(200);
    expect(res.json().storeName).toBe('Kahvila A');
    expect(res.json().balance).toBe(20);
    expect(res.json().entries).toMatchObject([
      { type: 'earn', points: 5, balanceAfter: 20 },
      { type: 'adjust', points: -10, balanceAfter: 15 },
      { type: 'earn', points: 25, balanceAfter: 25 },
    ]);
  });

  it('caps the list at 100 entries and keeps balanceAfter correct', async () => {
    const customerId = await makeCustomer('new@test.dev');
    const storeId = await makeStore('Kahvila A');

    await pool.query(
      `INSERT INTO points_ledger_entries (customer_id, store_id, type, points, created_at)
       SELECT $1, $2, 'earn', 1, timestamptz '2026-01-01 00:00:00+00' + (i || ' minutes')::interval
       FROM generate_series(1, 105) AS i`,
      [customerId, storeId],
    );
    await pool.query(
      `INSERT INTO points_balances (customer_id, store_id, balance) VALUES ($1, $2, 105)`,
      [customerId, storeId],
    );

    const res = await get(`/v1/customer/me/stores/${storeId}/history`, 'new@test.dev');

    expect(res.json().entries).toHaveLength(100);
    expect(res.json().entries[0]).toMatchObject({ points: 1, balanceAfter: 105 });
    expect(res.json().entries[99]).toMatchObject({ points: 1, balanceAfter: 6 });
  });

  it('refuses a store the customer has no history at', async () => {
    await makeCustomer('new@test.dev');
    const res = await get(
      `/v1/customer/me/stores/${randomUUID()}/history`,
      'new@test.dev',
    );
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'STORE_NOT_FOUND' } });
  });

  it("never shows another customer's history", async () => {
    const mine = await makeCustomer('mine@test.dev');
    const storeId = await makeStore('Kahvila A');
    await addEntry(mine, storeId, 'earn', 25, '2026-10-20T10:00:00Z');

    const res = await get(`/v1/customer/me/stores/${storeId}/history`, 'other@test.dev');

    expect(res.statusCode).toBe(404);
  });
});

describe('GET /v1/customer/me/expiring', () => {
  it('returns only batches inside the window, excluding zero and later ones', async () => {
    const customerId = await makeCustomer('new@test.dev');
    const storeId = await makeStore('Kahvila A');
    const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const inFiveDays = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const inTwentyDays = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();

    await addBatch(customerId, storeId, 5, inTenDays);
    await addBatch(customerId, storeId, 0, inFiveDays);
    await addBatch(customerId, storeId, 7, inTwentyDays);

    const res = await get('/v1/customer/me/expiring', 'new@test.dev');

    expect(res.statusCode).toBe(200);
    expect(res.json().windowDays).toBe(14);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0]).toMatchObject({
      storeName: 'Kahvila A',
      points: 5,
    });
  });

  it('honours a wider window when asked', async () => {
    const customerId = await makeCustomer('new@test.dev');
    const storeId = await makeStore('Kahvila A');
    const inTwentyDays = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    await addBatch(customerId, storeId, 7, inTwentyDays);

    const res = await get('/v1/customer/me/expiring?days=30', 'new@test.dev');

    expect(res.json().windowDays).toBe(30);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0]).toMatchObject({ points: 7 });
  });
});

describe('first sign-in under concurrency', () => {
  it('answers every simultaneous first call with the same customer and credential', async () => {
    // One app, five overlapping requests: this is the shape the app itself
    // produces when sign-in fires the auth listener and the screen's callback.
    const app = await buildApp({ db, customerResolver: createDevCustomerResolver() });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: 'GET',
          url: '/v1/customer/me',
          headers: { authorization: 'Bearer race@test.dev' },
        }),
      ),
    );
    await app.close();

    expect(results.map((res) => res.statusCode)).toEqual([200, 200, 200, 200, 200]);
    const identifiers = new Set(results.map((res) => res.json().credential.identifier));
    expect(identifiers.size).toBe(1);

    const customers = await pool.query('SELECT count(*) FROM customers');
    const credentials = await pool.query('SELECT count(*) FROM credentials');
    expect(Number(customers.rows[0].count)).toBe(1);
    expect(Number(credentials.rows[0].count)).toBe(1);
  });

  it('allows only one active app_qr credential per customer', async () => {
    const me = await get('/v1/customer/me', 'cred@test.dev');
    const customerId = me.json().customer.id as string;

    await expect(
      pool.query(
        `INSERT INTO credentials (customer_id, type, identifier)
         VALUES ($1, 'app_qr', 'CUS-SECOND000000000000000000')`,
        [customerId],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});

describe('expiring window edges', () => {
  it('includes a batch expiring exactly 14 days from now', async () => {
    const customerId = await makeCustomer('new@test.dev');
    const storeId = await makeStore('Kahvila A');
    const exactly = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    await addBatch(customerId, storeId, 9, exactly);

    const res = await get('/v1/customer/me/expiring', 'new@test.dev');

    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0]).toMatchObject({ points: 9 });
  });

  it('excludes a batch that has already expired', async () => {
    const customerId = await makeCustomer('new@test.dev');
    const storeId = await makeStore('Kahvila A');
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await addBatch(customerId, storeId, 5, yesterday);

    const res = await get('/v1/customer/me/expiring', 'new@test.dev');

    expect(res.json().items).toEqual([]);
  });
});

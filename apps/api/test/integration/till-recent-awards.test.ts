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
let cashierId: string;

async function inject(method: 'GET', url: string, token: string) {
  const app = await buildApp({ db, sessionResolver: createDevSessionResolver(db) });
  const res = await app.inject({
    method,
    url,
    headers: token === '' ? {} : { authorization: `Bearer ${token}` },
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
  cashierId = randomUUID();

  await pool.query(
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'rec-cashier@test.dev', 'Rita Register', false)",
    [cashierId],
  );
  await pool.query(
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'rec-other@test.dev', 'Olli Other', false)",
    [randomUUID()],
  );
  await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, 'Recent Store', 'active')", [
    storeId,
  ]);
  await pool.query(
    "INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, 'cashier')",
    [storeId, cashierId],
  );
});

/** One customer and one ledger earn entry under the test's cashier. */
async function insertEarn(
  name: string,
  points: number,
  minutesAgo: number,
  breakdown: unknown[] | null = null,
) {
  const customerId = randomUUID();
  await pool.query(
    "INSERT INTO customers (id, email, name, status) VALUES ($1, $2, $3, 'active')",
    [customerId, `${customerId}@mail.test`, name],
  );
  const entryId = randomUUID();
  await pool.query(
    `INSERT INTO points_ledger_entries
       (id, customer_id, store_id, type, points, amount_cents, rules_applied, staff_id, created_at)
     VALUES ($1, $2, $3, 'earn', $4, $5, $6, $7, now() - ($8 || ' minutes')::interval)`,
    [
      entryId,
      customerId,
      storeId,
      points,
      points * 100,
      breakdown === null ? null : JSON.stringify(breakdown),
      cashierId,
      String(minutesAgo),
    ],
  );
  return { entryId, customerId, name };
}

describe('the recent-awards list (till)', () => {
  it('shows this cashier’s own earn entries, newest first, with the customer’s name', async () => {
    await insertEarn('Aino Asiakas', 12, 30, [
      { type: 'per_euro', version: 2, points: 12, applied: true },
    ]);
    const newest = await insertEarn('Kai Kävijä', 5, 1);

    const res = await inject('GET', `/v1/stores/${storeId}/awards/recent`, 'rec-cashier@test.dev');
    expect(res.statusCode).toBe(200);
    const { entries } = res.json();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      entryId: newest.entryId,
      customerName: 'Kai Kävijä',
      points: 5,
      amountCents: 500,
    });
    expect(entries[0].breakdown).toBeNull();
    expect(entries[1].breakdown).toEqual([
      { type: 'per_euro', version: 2, points: 12, applied: true },
    ]);
    expect(new Date(entries[0].createdAt).getTime()).toBeGreaterThan(
      new Date(entries[1].createdAt).getTime(),
    );
  });

  it('honours the limit and skips everything that is not an award', async () => {
    await insertEarn('One', 1, 60);
    await insertEarn('Two', 2, 40);
    await insertEarn('Three', 3, 20);

    const adjustCustomer = randomUUID();
    await pool.query(
      "INSERT INTO customers (id, email, name, status) VALUES ($1, $2, 'Adjusted', 'active')",
      [adjustCustomer, `${adjustCustomer}@mail.test`],
    );
    await pool.query(
      `INSERT INTO points_ledger_entries (customer_id, store_id, type, points, staff_id)
       VALUES ($1, $2, 'adjust', -4, $3)`,
      [adjustCustomer, storeId, cashierId],
    );

    const res = await inject(
      'GET',
      `/v1/stores/${storeId}/awards/recent?limit=2`,
      'rec-cashier@test.dev',
    );
    expect(res.statusCode).toBe(200);
    const { entries } = res.json();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry: { customerName: string }) => entry.customerName)).toEqual([
      'Three',
      'Two',
    ]);
  });

  it('keeps another cashier’s awards out of this till’s list', async () => {
    const otherId = randomUUID();
    await pool.query(
      "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'rec-teammate@test.dev', 'Tessa Teammate', false)",
      [otherId],
    );
    await pool.query(
      "INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, 'cashier')",
      [storeId, otherId],
    );
    const customerId = randomUUID();
    await pool.query(
      "INSERT INTO customers (id, email, name, status) VALUES ($1, $2, 'Not Yours', 'active')",
      [customerId, `${customerId}@mail.test`],
    );
    await pool.query(
      `INSERT INTO points_ledger_entries (customer_id, store_id, type, points, staff_id)
       VALUES ($1, $2, 'earn', 9, $3)`,
      [customerId, storeId, otherId],
    );

    const res = await inject('GET', `/v1/stores/${storeId}/awards/recent`, 'rec-cashier@test.dev');
    expect(res.statusCode).toBe(200);
    expect(res.json().entries).toHaveLength(0);
  });

  it('refuses a stranger and a caller with no token', async () => {
    const stranger = await inject('GET', `/v1/stores/${storeId}/awards/recent`, 'rec-other@test.dev');
    expect(stranger.statusCode).toBe(403);

    const anonymous = await inject('GET', `/v1/stores/${storeId}/awards/recent`, '');
    expect(anonymous.statusCode).toBe(401);
  });
});

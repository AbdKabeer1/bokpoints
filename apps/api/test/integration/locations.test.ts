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

let soloStore: string;
let chainStore: string;
let otherStore: string;
let helsinki: string;
let tampere: string;
let closedBranch: string;
let otherStoreBranch: string;
let customerId: string;

async function staff(email: string): Promise<string> {
  const id = randomUUID();
  await pool.query('INSERT INTO staff_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    email,
    email,
  ]);
  return id;
}

async function member(storeId: string, userId: string, locationId: string | null) {
  await pool.query(
    "INSERT INTO store_members (store_id, user_id, role, location_id) VALUES ($1, $2, 'cashier', $3)",
    [storeId, userId, locationId],
  );
}

async function branch(storeId: string, name: string, status = 'active'): Promise<string> {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO store_locations (id, store_id, name, status) VALUES ($1, $2, $3, $4)',
    [id, storeId, name, status],
  );
  return id;
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
  soloStore = randomUUID();
  chainStore = randomUUID();
  otherStore = randomUUID();
  customerId = randomUUID();

  await pool.query(
    `INSERT INTO stores (id, name, status)
     VALUES ($1, 'Solo Shop', 'active'), ($2, 'Chain', 'active'), ($3, 'Elsewhere', 'active')`,
    [soloStore, chainStore, otherStore],
  );
  await pool.query(
    `INSERT INTO points_rules (store_id, rule_version, points_per_euro_thousandths, rounding, active_from)
     SELECT id, 1, 1000, 'floor', now() FROM stores`,
  );
  await pool.query('INSERT INTO customers (id, email, name) VALUES ($1, $2, $3)', [
    customerId,
    'customer@test.dev',
    'Aino',
  ]);

  helsinki = await branch(chainStore, 'Helsinki');
  tampere = await branch(chainStore, 'Tampere');
  closedBranch = await branch(chainStore, 'Closed', 'closed');
  otherStoreBranch = await branch(otherStore, 'Oulu');

  await member(soloStore, await staff('solo@test.dev'), null);
  await member(chainStore, await staff('everywhere@test.dev'), null);
  await member(chainStore, await staff('helsinki@test.dev'), helsinki);
});

const award = async (email: string, storeId: string, locationId?: string) => {
  const app = await buildApp({ db, sessionResolver: createDevSessionResolver(db) });
  const res = await app.inject({
    method: 'POST',
    url: `/v1/stores/${storeId}/awards`,
    headers: { authorization: `Bearer ${email}`, 'idempotency-key': randomUUID() },
    payload: { customerId, amountCents: 1000, ...(locationId ? { locationId } : {}) },
  });
  await app.close();
  return res;
};

const lastEntryLocation = async (storeId: string): Promise<string | null> => {
  const rows = await pool.query(
    'SELECT location_id FROM points_ledger_entries WHERE store_id = $1 ORDER BY created_at DESC LIMIT 1',
    [storeId],
  );
  return rows.rows[0].location_id;
};

describe('a store with no branches (not every business has them)', () => {
  it('awards exactly as before, with no branch recorded', async () => {
    const res = await award('solo@test.dev', soloStore);
    expect(res.statusCode).toBe(201);
    expect(await lastEntryLocation(soloStore)).toBeNull();
  });

  it('refuses a branch that does not exist', async () => {
    const res = await award('solo@test.dev', soloStore, randomUUID());
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'LOCATION_INVALID' } });
  });
});

describe('a store with branches (D-103, D-104)', () => {
  it('asks a store-wide member to say which branch', async () => {
    const res = await award('everywhere@test.dev', chainStore);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'LOCATION_REQUIRED' } });
  });

  it('records the branch a store-wide member names', async () => {
    const res = await award('everywhere@test.dev', chainStore, tampere);
    expect(res.statusCode).toBe(201);
    expect(await lastEntryLocation(chainStore)).toBe(tampere);
  });

  it('uses the branch a limited member is tied to, without being told', async () => {
    const res = await award('helsinki@test.dev', chainStore);
    expect(res.statusCode).toBe(201);
    expect(await lastEntryLocation(chainStore)).toBe(helsinki);
  });

  it('accepts a limited member naming their own branch', async () => {
    const res = await award('helsinki@test.dev', chainStore, helsinki);
    expect(res.statusCode).toBe(201);
  });

  it('refuses a limited member naming a different branch (403 LOCATION_MISMATCH)', async () => {
    const res = await award('helsinki@test.dev', chainStore, tampere);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'LOCATION_MISMATCH' } });
  });

  it('refuses a closed branch', async () => {
    const res = await award('everywhere@test.dev', chainStore, closedBranch);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'LOCATION_INVALID' } });
  });

  it("refuses another store's branch", async () => {
    const res = await award('everywhere@test.dev', chainStore, otherStoreBranch);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'LOCATION_INVALID' } });
  });

  it('keeps points shared across the branches of one store', async () => {
    await award('everywhere@test.dev', chainStore, helsinki);
    await award('everywhere@test.dev', chainStore, tampere);
    const rows = await pool.query(
      'SELECT balance FROM points_balances WHERE customer_id = $1 AND store_id = $2',
      [customerId, chainStore],
    );
    expect(rows.rows).toEqual([{ balance: 20 }]);
  });
});

describe('the database refuses a branch from a different store', () => {
  it('on a membership', async () => {
    const userId = await staff('crossed@test.dev');
    await expect(member(chainStore, userId, otherStoreBranch)).rejects.toThrow(
      /store_members_location_store_fk/,
    );
  });

  it('on a ledger entry', async () => {
    await expect(
      pool.query(
        `INSERT INTO points_ledger_entries (customer_id, store_id, type, points, location_id)
         VALUES ($1, $2, 'adjust', 5, $3)`,
        [customerId, chainStore, otherStoreBranch],
      ),
    ).rejects.toThrow(/points_ledger_entries_location_store_fk/);
  });
});

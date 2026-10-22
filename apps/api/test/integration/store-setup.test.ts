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

let adminId: string;
let otherOwnerId: string;
let otherStoreId: string;

async function staffUser(email: string, isAdmin: boolean): Promise<string> {
  const id = randomUUID();
  await pool.query('INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, $2, $3, $4)', [
    id,
    email,
    email,
    isAdmin,
  ]);
  return id;
}

/** A first owner for a fresh store. There is nobody to invite them yet. */
const validStorePayload = {
  name: 'Kahvila Aino',
  address: 'Mannerheimintie 1, Helsinki',
  contactName: 'Aino Virtanen',
  contactEmail: 'aino@kahvila.example',
  pointsRule: {
    pointsPerEuroThousandths: 500,
    rounding: 'nearest',
    minPurchaseCents: 200,
    maxPointsPerTransaction: 1000,
  },
  branches: [
    { name: 'Kamppi', address: 'Kamppi 2' },
    { name: 'Töölö' },
  ],
  owner: {
    email: 'owner.aino@test.dev',
    name: 'Aino Owner',
    authUserId: randomUUID(),
  },
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
  adminId = await staffUser('admin@test.dev', true);
  // A store that already exists, with a role on it, so the tests can prove
  // that being a member of one store does not let you create another.
  otherStoreId = randomUUID();
  otherOwnerId = await staffUser('owner.elsewhere@test.dev', false);
  await pool.query(`INSERT INTO stores (id, name, status) VALUES ($1, 'Elsewhere', 'active')`, [
    otherStoreId,
  ]);
  await pool.query(
    `INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [otherStoreId, otherOwnerId],
  );
});

const postAdminStores = async (token: string | null, payload: unknown) => {
  const app = await buildApp({ db, sessionResolver: createDevSessionResolver(db) });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/admin/stores',
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    payload,
  });
  await app.close();
  return res;
};

describe('an admin creating a store (POST /v1/admin/stores)', () => {
  it('creates the store with its rule, branches and first owner', async () => {
    const ownerAuthUserId = randomUUID();
    const payload = { ...validStorePayload, owner: { ...validStorePayload.owner, authUserId: ownerAuthUserId } };
    const res = await postAdminStores('admin@test.dev', payload);

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('active');
    expect(body.name).toBe('Kahvila Aino');
    expect(body.rule).toMatchObject({
      ruleVersion: 1,
      pointsPerEuroThousandths: 500,
      rounding: 'nearest',
      minPurchaseCents: 200,
      maxPointsPerTransaction: 1000,
    });
    expect(body.branches).toHaveLength(2);
    expect(body.branches.map((b: { name: string }) => b.name)).toEqual(['Kamppi', 'Töölö']);
    expect(body.owner.email).toBe('owner.aino@test.dev');
    expect(body.owner.locationId).toBeNull();

    // The database state: one store, one rule, two branches, one owner member.
    const storeRow = await pool.query('SELECT status FROM stores WHERE id = $1', [body.storeId]);
    expect(storeRow.rows[0].status).toBe('active');

    const ruleRow = await pool.query(
      'SELECT rule_version, points_per_euro_thousandths, rounding FROM points_rules WHERE store_id = $1',
      [body.storeId],
    );
    expect(ruleRow.rows).toEqual([
      { rule_version: 1, points_per_euro_thousandths: 500, rounding: 'nearest' },
    ]);

    const branchRows = await pool.query(
      'SELECT name, status FROM store_locations WHERE store_id = $1 ORDER BY name',
      [body.storeId],
    );
    expect(branchRows.rows).toEqual([
      { name: 'Kamppi', status: 'active' },
      { name: 'Töölö', status: 'active' },
    ]);

    const memberRow = await pool.query(
      "SELECT role, status, location_id FROM store_members WHERE store_id = $1",
      [body.storeId],
    );
    expect(memberRow.rows).toEqual([{ role: 'owner', status: 'active', location_id: null }]);

    const ownerRow = await pool.query(
      'SELECT auth_user_id FROM staff_users WHERE lower(email) = $1',
      ['owner.aino@test.dev'],
    );
    expect(ownerRow.rows[0].auth_user_id).toBe(ownerAuthUserId);

    const auditRows = await pool.query(
      "SELECT action, actor_id FROM audit_log_entries WHERE store_id = $1",
      [body.storeId],
    );
    expect(auditRows.rows[0]).toMatchObject({ action: 'store.create', actor_id: adminId });
  });

  it('is refused for a staff member who is not an admin (FRD section 2)', async () => {
    const res = await postAdminStores('owner.elsewhere@test.dev', validStorePayload);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('needs a token at all', async () => {
    const res = await postAdminStores(null, validStorePayload);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'MISSING_TOKEN' } });
  });

  it('refuses an earn rate outside the bounded range (D-093)', async () => {
    for (const pointsPerEuroThousandths of [0, 1_000_001]) {
      const res = await postAdminStores('admin@test.dev', {
        ...validStorePayload,
        pointsRule: { ...validStorePayload.pointsRule, pointsPerEuroThousandths },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('creates a store with no branches at all (the common case)', async () => {
    const res = await postAdminStores('admin@test.dev', {
      ...validStorePayload,
      branches: undefined,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().branches).toEqual([]);
    const branchRows = await pool.query(
      'SELECT count(*) FROM store_locations WHERE store_id = $1',
      [res.json().storeId],
    );
    expect(Number(branchRows.rows[0].count)).toBe(0);
  });

  it('defaults the rounding to floor and of the optional rule fields', async () => {
    const res = await postAdminStores('admin@test.dev', {
      ...validStorePayload,
      pointsRule: { pointsPerEuroThousandths: 1000 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().rule).toMatchObject({ rounding: 'floor' });
    expect(res.json().rule).not.toHaveProperty('minPurchaseCents');
    expect(res.json().rule).not.toHaveProperty('maxPointsPerTransaction');
  });
});

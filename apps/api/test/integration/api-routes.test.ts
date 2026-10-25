import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDevSessionResolver } from '../../src/auth/dev-session.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { applyMigrations, truncateAll } from '../../src/db/migrate.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

let pool: ReturnType<typeof createPool>;
let db: Database;

const CASHIER = { email: 'cashier@test.dev', name: 'Test Cashier' };
const OWNER_A = { email: 'owner-a@test.dev', name: 'Owner A' };
const OWNER_B = { email: 'owner-b@test.dev', name: 'Owner B' };
const ADMIN = { email: 'admin@test.dev', name: 'Test Admin' };
const CUSTOMER = { email: 'customer@test.dev', name: 'Aino Virtanen' };

let storeA: string;
let storeB: string;
let customerId: string;
let credentialIdentifier: string;

async function insertStaff(staff: { email: string; name: string }, isAdmin = false): Promise<string> {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, $2, $3, $4)',
    [id, staff.email, staff.name, isAdmin],
  );
  return id;
}

async function insertMember(storeId: string, userId: string, role: string): Promise<void> {
  await pool.query('INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, $3)', [
    storeId,
    userId,
    role,
  ]);
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

  storeA = randomUUID();
  storeB = randomUUID();
  customerId = randomUUID();
  credentialIdentifier = `cred_${randomUUID().replace(/-/g, '')}`;

  await pool.query(
    "INSERT INTO stores (id, name, status) VALUES ($1, $2, 'active'), ($3, $4, 'active')",
    [storeA, 'Store A', storeB, 'Store B'],
  );

  const cashierId = await insertStaff(CASHIER);
  const ownerAId = await insertStaff(OWNER_A);
  const ownerBId = await insertStaff(OWNER_B);
  await insertStaff(ADMIN, true);

  await insertMember(storeA, cashierId, 'cashier');
  await insertMember(storeA, ownerAId, 'owner');
  await insertMember(storeB, ownerBId, 'owner');

  // A store with no points rule cannot award anything.
  await pool.query(
    `INSERT INTO points_rules (store_id, rule_version, points_per_euro_thousandths, rounding, active_from)
     VALUES ($1, 1, 1000, 'floor', now()), ($2, 1, 1000, 'floor', now())`,
    [storeA, storeB],
  );

  await pool.query('INSERT INTO customers (id, email, name) VALUES ($1, $2, $3)', [
    customerId,
    CUSTOMER.email,
    CUSTOMER.name,
  ]);
  await pool.query(
    'INSERT INTO credentials (customer_id, type, identifier) VALUES ($1, $2, $3)',
    [customerId, 'app_qr', credentialIdentifier],
  );
});

function makeApp() {
  return buildApp({ db, sessionResolver: createDevSessionResolver(db) });
}

const auth = (email: string) => ({ authorization: `Bearer ${email}` });

describe('authentication', () => {
  it('refuses an award with no token (401)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: { 'idempotency-key': 'k1' },
      payload: { customerId, amountCents: 2380 },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'MISSING_TOKEN' } });
    await app.close();
  });

  it('refuses an award with an unknown token (401)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth('nobody@test.dev'), 'idempotency-key': 'k1' },
      payload: { customerId, amountCents: 2380 },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'INVALID_TOKEN' } });
    await app.close();
  });

  it('refuses every protected route when no session resolver is configured', async () => {
    // Safe by default: without a resolver nobody is authenticated, so the
    // routes refuse rather than trusting the token.
    const app = await buildApp({ db });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth(CASHIER.email), 'idempotency-key': 'k1' },
      payload: { customerId, amountCents: 2380 },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('POST /v1/stores/:storeId/awards', () => {
  it('awards points to a customer (201)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth(CASHIER.email), 'idempotency-key': 'k1' },
      payload: { customerId, amountCents: 2380 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ awarded: true, points: 23 });
    expect(res.json().entryId).toBeTruthy();
    await app.close();
  });

  it('never awards twice for the same idempotency key (200, AC-2)', async () => {
    const app = await makeApp();
    const request = {
      method: 'POST' as const,
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth(CASHIER.email), 'idempotency-key': 'same-key' },
      payload: { customerId, amountCents: 2380 },
    };

    const first = await app.inject(request);
    const second = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().entryId).toBe(first.json().entryId);

    const balance = await app.inject({
      method: 'GET',
      url: `/v1/stores/${storeA}/customers/${customerId}/balance`,
      headers: auth(CASHIER.email),
    });
    expect(balance.json()).toMatchObject({ balance: 23 });
    await app.close();
  });

  it('refuses a cashier awarding at another store (403, store isolation)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeB}/awards`,
      headers: { ...auth(CASHIER.email), 'idempotency-key': 'k1' },
      payload: { customerId, amountCents: 2380 },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'STORE_MISMATCH' } });
    await app.close();
  });

  it('refuses an admin awarding points (403, FRD section 2)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth(ADMIN.email), 'idempotency-key': 'k1' },
      payload: { customerId, amountCents: 2380 },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    await app.close();
  });

  it('requires an idempotency key (400)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: auth(CASHIER.email),
      payload: { customerId, amountCents: 2380 },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects an invalid body (400)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth(CASHIER.email), 'idempotency-key': 'k1' },
      payload: { customerId: 'not-a-uuid', amountCents: -5 },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('reports a below-minimum purchase without awarding (FR-PTS-2)', async () => {
    const app = await makeApp();
    await pool.query(
      'UPDATE points_rules SET min_purchase_cents = 1000 WHERE store_id = $1',
      [storeA],
    );

    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth(CASHIER.email), 'idempotency-key': 'k1' },
      payload: { customerId, amountCents: 400 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ awarded: false, reason: 'below_minimum', points: 0 });
    await app.close();
  });
});

describe('POST /v1/stores/:storeId/identify', () => {
  it('resolves a credential to a customer and their balance at this store (FR-STO-9)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/identify`,
      headers: auth(CASHIER.email),
      payload: { credentialIdentifier, credentialType: 'app_qr' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      customerId,
      firstName: 'Aino',
      balance: 0,
    });
    await app.close();
  });

  it('returns 404 for an unknown credential', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/identify`,
      headers: auth(CASHIER.email),
      payload: { credentialIdentifier: 'nope' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'CREDENTIAL_NOT_FOUND' } });
    await app.close();
  });
});

describe('GET /v1/stores/:storeId/customers/:customerId/balance', () => {
  it('returns the balance at that store only (AC-3)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/stores/${storeA}/customers/${customerId}/balance`,
      headers: auth(CASHIER.email),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ customerId, storeId: storeA, balance: 0 });
    await app.close();
  });

  it('refuses a cashier reading a customer at another store (403)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/stores/${storeB}/customers/${customerId}/balance`,
      headers: auth(CASHIER.email),
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('store and account status (FR-PTS-6)', () => {
  it('refuses an award at a suspended store', async () => {
    await pool.query("UPDATE stores SET status = 'suspended' WHERE id = $1", [storeA]);
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth(CASHIER.email), 'idempotency-key': 'k1' },
      payload: { customerId, amountCents: 2380 },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'STORE_NOT_AWARDING' } });
    await app.close();
  });

  it('refuses an award at an offboarded store', async () => {
    await pool.query("UPDATE stores SET status = 'offboarded' WHERE id = $1", [storeA]);
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth(CASHIER.email), 'idempotency-key': 'k1' },
      payload: { customerId, amountCents: 2380 },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('still awards at a paused store, because awarding continues (D-042)', async () => {
    await pool.query("UPDATE stores SET status = 'paused' WHERE id = $1", [storeA]);
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth(CASHIER.email), 'idempotency-key': 'k1' },
      payload: { customerId, amountCents: 2380 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ awarded: true, points: 23 });
    await app.close();
  });

  it('refuses a deactivated staff account', async () => {
    await pool.query("UPDATE staff_users SET status = 'deactivated' WHERE email = $1", [
      CASHIER.email,
    ]);
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth(CASHIER.email), 'idempotency-key': 'k1' },
      payload: { customerId, amountCents: 2380 },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'ACCOUNT_DEACTIVATED' } });
    await app.close();
  });

  it('refuses an award to a deleted customer', async () => {
    await pool.query("UPDATE customers SET status = 'deleted' WHERE id = $1", [customerId]);
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth(CASHIER.email), 'idempotency-key': 'k1' },
      payload: { customerId, amountCents: 2380 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'CUSTOMER_NOT_FOUND' } });
    await app.close();
  });
});

describe('credential state (FR-CRD-4)', () => {
  it('does not resolve a revoked credential', async () => {
    await pool.query("UPDATE credentials SET status = 'revoked' WHERE identifier = $1", [
      credentialIdentifier,
    ]);
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/identify`,
      headers: auth(CASHIER.email),
      payload: { credentialIdentifier, credentialType: 'app_qr' },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('does not resolve a lost credential', async () => {
    await pool.query("UPDATE credentials SET status = 'lost' WHERE identifier = $1", [
      credentialIdentifier,
    ]);
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/identify`,
      headers: auth(CASHIER.email),
      payload: { credentialIdentifier, credentialType: 'app_qr' },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('does not resolve a credential past its validity', async () => {
    await pool.query(
      "UPDATE credentials SET valid_until = now() - interval '1 day' WHERE identifier = $1",
      [credentialIdentifier],
    );
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/identify`,
      headers: auth(CASHIER.email),
      payload: { credentialIdentifier, credentialType: 'app_qr' },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('does not resolve a credential of another type', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/identify`,
      headers: auth(CASHIER.email),
      payload: { credentialIdentifier, credentialType: 'nfc_card' },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('the points rule in force', () => {
  it('ignores a rule that is not active yet (FR-STO-5)', async () => {
    await pool.query(
      `INSERT INTO points_rules (store_id, rule_version, points_per_euro_thousandths, rounding, active_from)
       VALUES ($1, 2, 2000, 'floor', now() + interval '7 days')`,
      [storeA],
    );
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth(CASHIER.email), 'idempotency-key': 'k1' },
      payload: { customerId, amountCents: 2380 },
    });

    // The active rule is still 1 point per euro, not the future 2.
    expect(res.json()).toMatchObject({ awarded: true, points: 23 });
    await app.close();
  });
});

describe('the award request', () => {
  it('answers 404 for a customer that does not exist, not a 500', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth(CASHIER.email), 'idempotency-key': 'k1' },
      payload: { customerId: randomUUID(), amountCents: 2380 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'CUSTOMER_NOT_FOUND' } });
    await app.close();
  });

  it('refuses the same idempotency key with a different amount (409)', async () => {
    const app = await makeApp();
    const headers = { ...auth(CASHIER.email), 'idempotency-key': 'reused' };

    const first = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers,
      payload: { customerId, amountCents: 2380 },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers,
      payload: { customerId, amountCents: 5000 },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    await app.close();
  });

  it('refuses an amount beyond the sanity cap (400)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth(CASHIER.email), 'idempotency-key': 'k1' },
      payload: { customerId, amountCents: 100_000_000_000 },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('abuse controls', () => {
  it('rate limits the awarding endpoint (AGENT.md section 8)', async () => {
    const app = await buildApp({
      db,
      sessionResolver: createDevSessionResolver(db),
      rateLimit: { max: 3, timeWindow: '1 minute' },
    });

    const request = {
      method: 'POST' as const,
      url: `/v1/stores/${storeA}/awards`,
      headers: { ...auth(CASHIER.email), 'idempotency-key': 'rl' },
      payload: { customerId, amountCents: 100 },
    };

    expect((await app.inject(request)).statusCode).toBe(201);
    expect((await app.inject(request)).statusCode).toBe(200);
    expect((await app.inject(request)).statusCode).toBe(200);
    expect((await app.inject(request)).statusCode).toBe(429);
    await app.close();
  });
});

describe('email uniqueness (FR-AUTH-3)', () => {
  it('treats an email in a different case as the same customer', async () => {
    await pool.query('INSERT INTO customers (email, name) VALUES ($1, $2)', [
      'Same@Shop.dev',
      'Upper',
    ]);

    const error = await pool
      .query('INSERT INTO customers (email, name) VALUES ($1, $2)', ['same@shop.dev', 'Lower'])
      .catch((e: { code?: string }) => e);

    expect((error as { code?: string }).code).toBe('23505');
  });
});

describe('the interactive documentation', () => {
  it('is not served when it is turned off', async () => {
    const app = await buildApp({ db, enableDocs: false });
    const res = await app.inject({ method: 'GET', url: '/v1/docs/' });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('does not serve the OpenAPI document when docs are off', async () => {
    const app = await buildApp({ db, enableDocs: false });
    const res = await app.inject({ method: 'GET', url: '/v1/openapi.json' });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('the API is documented (FR-API-3)', () => {
  it('serves an OpenAPI document that lists the award route', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/v1/openapi.json' });

    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(Object.keys(spec.paths)).toContain('/v1/stores/{storeId}/awards');
    expect(spec.info.title).toBeTruthy();
    await app.close();
  });
});

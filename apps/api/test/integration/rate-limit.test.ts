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

const CASHIER_EMAIL = 'cashier@test.dev';
let storeId: string;
let customerId: string;

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
  customerId = randomUUID();

  await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, $2, 'active')", [
    storeId,
    `S-${randomUUID()}`,
  ]);

  const staffId = randomUUID();
  await pool.query('INSERT INTO staff_users (id, email, name) VALUES ($1, $2, $3)', [
    staffId,
    CASHIER_EMAIL,
    'Test Cashier',
  ]);
  await pool.query('INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, $3)', [
    storeId,
    staffId,
    'cashier',
  ]);
  await pool.query(
    `INSERT INTO points_rules (store_id, rule_version, points_per_euro_thousandths, rounding, active_from)
     VALUES ($1, 1, 1000, 'floor', now())`,
    [storeId],
  );
  await pool.query('INSERT INTO customers (id, email, name) VALUES ($1, $2, $3)', [
    customerId,
    `c-${randomUUID()}@t.dev`,
    'Aino Virtanen',
  ]);
});

/**
 * A limit of 1 per window, so any two requests with the same rate-limit
 * key collide and the second one answers 429.
 */
async function makeApp(trustProxy: boolean) {
  return buildApp({
    db,
    sessionResolver: createDevSessionResolver(db),
    rateLimit: { max: 1, timeWindow: '1 minute' },
    trustProxy,
  });
}

function awardRequest(forwardedFor?: string) {
  return {
    method: 'POST',
    url: `/v1/stores/${storeId}/awards`,
    headers: {
      authorization: `Bearer ${CASHIER_EMAIL}`,
      'idempotency-key': randomUUID(),
      ...(forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor }),
    },
    payload: { customerId, amountCents: 2380 },
  };
}

describe('rate limiting behind a proxy (D-095)', () => {
  it('counts callers separately when the proxy address is trusted', async () => {
    const app = await makeApp(true);

    // Two different client IPs behind the proxy: each gets its own bucket.
    const first = await app.inject(awardRequest('203.0.113.10'));
    const second = await app.inject(awardRequest('203.0.113.11'));

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    await app.close();
  });

  it('counts two callers as one when the proxy address is not trusted', async () => {
    const app = await makeApp(false);

    const first = await app.inject(awardRequest('203.0.113.10'));
    const second = await app.inject(awardRequest('203.0.113.11'));

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(429);
    await app.close();
  });

  it('applies a global limit to a previously unlimited route and sends Retry-After', async () => {
    const app = await buildApp({
      db,
      globalRateLimit: { max: 2, timeWindow: '1 minute' },
    });
    const first = await app.inject({ method: 'GET', url: '/v1/health' });
    const second = await app.inject({ method: 'GET', url: '/v1/health' });
    const third = await app.inject({ method: 'GET', url: '/v1/health' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
    await app.close();
  });

  it('turns awarding off for every store with the kill switch', async () => {
    const app = await buildApp({
      db,
      sessionResolver: createDevSessionResolver(db),
      awardingEnabled: false,
    });
    const res = await app.inject(awardRequest());
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('AWARDING_DISABLED');
    await app.close();
  });
});

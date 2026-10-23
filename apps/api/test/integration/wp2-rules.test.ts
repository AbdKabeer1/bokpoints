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
let customerId: string;

async function inject(
  method: 'GET' | 'POST',
  url: string,
  token: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const app = await buildApp({ db, sessionResolver: createDevSessionResolver(db) });
  const res = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, ...headers },
    ...(payload === undefined ? {} : { payload }),
  });
  await app.close();
  return res;
}

const award = (amountCents: number) =>
  inject('POST', `/v1/stores/${storeId}/awards`, 'cashier@test.dev', { customerId, amountCents }, {
    'idempotency-key': randomUUID(),
  });

const preview = (amountCents: number) =>
  inject('POST', `/v1/stores/${storeId}/awards/preview`, 'cashier@test.dev', {
    customerId,
    amountCents,
  });

async function addRule(input: {
  type: 'per_euro' | 'fixed_per_purchase' | 'threshold_bonus';
  params: Record<string, unknown>;
  conditions?: Record<string, unknown>;
  status?: string;
  effectiveFrom?: Date;
  version: number;
}) {
  await pool.query(
    `INSERT INTO earning_rules (store_id, type, params, conditions, effective_from, status, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      storeId,
      input.type,
      JSON.stringify(input.params),
      JSON.stringify(input.conditions ?? {}),
      input.effectiveFrom ?? new Date(),
      input.status ?? 'active',
      input.version,
    ],
  );
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
  customerId = randomUUID();

  await pool.query(
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'cashier@test.dev', 'Cashier', false)",
    [randomUUID()],
  );
  await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, 'Kahvila Rules', 'active')", [
    storeId,
  ]);
  const cashier = await pool.query("SELECT id FROM staff_users WHERE email = 'cashier@test.dev'");
  await pool.query("INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, 'cashier')", [
    storeId,
    cashier.rows[0].id,
  ]);
  await pool.query(
    "INSERT INTO customers (id, email, name) VALUES ($1, 'rules@test.dev', 'Rules Customer')",
    [customerId],
  );
});

describe('the earning-rule set (WP2)', () => {
  it('adds the points from every active rule, in the preview and the award', async () => {
    await addRule({ type: 'per_euro', version: 1, params: { pointsPerEuroThousandths: 1000 } });
    await addRule({ type: 'fixed_per_purchase', version: 2, params: { points: 5 } });

    const quoted = await preview(2500);
    expect(quoted.statusCode).toBe(200);
    expect(quoted.json()).toMatchObject({ points: 30, awarded: true });
    expect(quoted.json().breakdown).toHaveLength(2);

    const awarded = await award(2500);
    expect(awarded.statusCode).toBe(201);
    expect(awarded.json()).toMatchObject({ points: 30, awarded: true });
    expect(awarded.json().breakdown).toHaveLength(2);

    const entry = await pool.query(
      "SELECT points, rules_applied FROM points_ledger_entries WHERE type = 'earn'",
    );
    expect(entry.rows[0].points).toBe(30);
    expect(entry.rows[0].rules_applied).toHaveLength(2);

    const balance = await pool.query(
      'SELECT balance FROM points_balances WHERE customer_id = $1 AND store_id = $2',
      [customerId, storeId],
    );
    expect(balance.rows[0].balance).toBe(30);
  });

  it('caps the total at the store per-sale ceiling', async () => {
    await pool.query('UPDATE stores SET max_points_per_sale = 20 WHERE id = $1', [storeId]);
    await addRule({ type: 'per_euro', version: 1, params: { pointsPerEuroThousandths: 1000 } });
    await addRule({ type: 'fixed_per_purchase', version: 2, params: { points: 5 } });

    const quoted = await preview(2500);
    expect(quoted.json()).toMatchObject({ points: 20 });

    const awarded = await award(2500);
    expect(awarded.json()).toMatchObject({ points: 20 });
  });

  it('leaves paused and not-yet-effective rules out', async () => {
    await addRule({ type: 'per_euro', version: 1, params: { pointsPerEuroThousandths: 1000 } });
    await addRule({
      type: 'fixed_per_purchase',
      version: 2,
      params: { points: 50 },
      status: 'paused',
    });
    await addRule({
      type: 'fixed_per_purchase',
      version: 3,
      params: { points: 40 },
      effectiveFrom: new Date(Date.now() + 86_400_000),
    });

    const quoted = await preview(2500);
    expect(quoted.json()).toMatchObject({ points: 25 });
    expect(quoted.json().breakdown).toHaveLength(1);
  });

  it('still awards a store that only has the legacy points_rules row', async () => {
    await pool.query(
      `INSERT INTO points_rules
        (store_id, rule_version, points_per_euro_thousandths, min_purchase_cents, max_points_per_transaction, rounding, active_from)
       VALUES ($1, 1, 1000, 200, 5000, 'floor', now())`,
      [storeId],
    );

    const awarded = await award(2500);
    expect(awarded.statusCode).toBe(201);
    expect(awarded.json()).toMatchObject({ points: 25 });
  });

  it('refuses an award when the store has no rules at all', async () => {
    const res = await award(2500);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'NO_ACTIVE_RULE' } });
  });
});

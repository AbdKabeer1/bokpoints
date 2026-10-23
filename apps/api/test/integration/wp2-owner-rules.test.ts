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

const listRules = (token = 'owner@test.dev') =>
  inject('GET', `/v1/stores/${storeId}/rules`, token);

const createRule = (definition: Record<string, unknown>, token = 'owner@test.dev') =>
  inject('POST', `/v1/stores/${storeId}/rules`, token, { definition });

const newVersion = (
  ruleId: string,
  definition: Record<string, unknown>,
  token = 'owner@test.dev',
) => inject('POST', `/v1/stores/${storeId}/rules/${ruleId}/version`, token, { definition });

const setStatus = (
  ruleId: string,
  status: string,
  token = 'owner@test.dev',
) => inject('POST', `/v1/stores/${storeId}/rules/${ruleId}/status`, token, { status });

const simulate = (body: Record<string, unknown>, token = 'owner@test.dev') =>
  inject('POST', `/v1/stores/${storeId}/rules/simulate`, token, body);

const award = (amountCents: number) =>
  inject(
    'POST',
    `/v1/stores/${storeId}/awards`,
    'cashier@test.dev',
    { customerId, amountCents },
    { 'idempotency-key': randomUUID() },
  );

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
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'owner@test.dev', 'Owner', false)",
    [randomUUID()],
  );
  await pool.query(
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'cashier@test.dev', 'Cashier', false)",
    [randomUUID()],
  );
  await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, 'Rules Portal', 'active')", [
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
  await pool.query(
    "INSERT INTO customers (id, email, name) VALUES ($1, 'portal@test.dev', 'Portal Customer')",
    [customerId],
  );
});

describe("the owner's rule endpoints (WP2, FR-RUL)", () => {
  it('lists the rule versions newest first, with their statuses', async () => {
    await pool.query(
      `INSERT INTO earning_rules (store_id, type, params, conditions, effective_from, status, version)
       VALUES ($1, 'per_euro', '{"pointsPerEuroThousandths":1000}', '{}', now(), 'superseded', 1)`,
      [storeId],
    );
    await pool.query(
      `INSERT INTO earning_rules (store_id, rule_key, type, params, conditions, effective_from, status, version)
       VALUES (
         $1,
         (SELECT rule_key FROM earning_rules WHERE store_id = $1 LIMIT 1),
         'per_euro', '{"pointsPerEuroThousandths":500}', '{}', now(), 'active', 2
       )`,
      [storeId],
    );

    const res = await listRules();
    expect(res.statusCode).toBe(200);
    const rules = res.json().rules;
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ version: 2, status: 'active' });
    expect(rules[1]).toMatchObject({ version: 1, status: 'superseded' });
  });

  it('creating a rule takes the next store version and starts awarding', async () => {
    await pool.query(
      `INSERT INTO earning_rules (store_id, type, params, conditions, effective_from, status, version)
       VALUES ($1, 'per_euro', '{"pointsPerEuroThousandths":1000}', '{}', now(), 'active', 1)`,
      [storeId],
    );

    const created = await createRule({ type: 'fixed_per_purchase', points: 5 });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      version: 2,
      status: 'active',
      definition: { type: 'fixed_per_purchase', points: 5 },
    });

    const rules = (await listRules()).json().rules;
    expect(rules.map((rule: { version: number }) => rule.version)).toEqual([2, 1]);

    const awarded = await award(10_00);
    expect(awarded.statusCode).toBe(201);
    expect(awarded.json()).toMatchObject({ points: 15, awarded: true });
  });

  it('editing a rule supersedes the old version instead of rewriting it', async () => {
    await pool.query(
      `INSERT INTO earning_rules (store_id, type, params, conditions, effective_from, status, version)
       VALUES ($1, 'per_euro', '{"pointsPerEuroThousandths":1000}', '{}', now(), 'active', 1)`,
      [storeId],
    );
    await pool.query(
      `INSERT INTO customers (id, email, name) VALUES ($1, 'points@test.dev', 'Seed Customer')`,
      [randomUUID()],
    );

    const original = (await listRules()).json().rules[0].ruleId;

    const edited = await newVersion(original, {
      type: 'per_euro',
      pointsPerEuroThousandths: 500,
    });
    expect(edited.statusCode).toBe(201);
    expect(edited.json()).toMatchObject({ version: 2 });

    const rules = (await listRules()).json().rules;
    const oldRow = rules.find((rule: { version: number }) => rule.version === 1);
    const newRow = rules.find((rule: { version: number }) => rule.version === 2);
    expect(oldRow).toMatchObject({ status: 'superseded' });
    expect(newRow).toMatchObject({ status: 'active' });
    expect(oldRow.ruleKey).toBe(newRow.ruleKey);

    // The superseded row refuses further edits (history, FR-RUL-4).
    const again = await newVersion(original, { type: 'fixed_per_purchase', points: 10 });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: { code: 'RULE_SUPERSEDED', message: expect.any(String) } });

    const awarded = await award(10_00);
    expect(awarded.json()).toMatchObject({ points: 5 });
  });

  it('pausing the last rule stops awarding; resuming restores it', async () => {
    const created = await createRule({ type: 'fixed_per_purchase', points: 5 });
    const ruleId = created.json().ruleId;

    const paused = await setStatus(ruleId, 'paused');
    expect(paused.statusCode).toBe(200);
    expect(paused.json()).toMatchObject({ status: 'paused' });

    const stopped = await award(10_00);
    expect(stopped.statusCode).toBe(409);
    expect(stopped.json()).toEqual({
      error: { code: 'NO_ACTIVE_RULE', message: expect.any(String) },
    });

    const resumed = await setStatus(ruleId, 'active');
    expect(resumed.json()).toMatchObject({ status: 'active' });

    const awarded = await award(10_00);
    expect(awarded.statusCode).toBe(201);
    expect(awarded.json()).toMatchObject({ points: 5 });
  });

  it('awards an every_nth_visit rule on the third purchase', async () => {
    const created = await createRule({ type: 'every_nth_visit', points: 50, everyN: 3 });
    expect(created.statusCode).toBe(201);

    const first = await award(10_00);
    expect(first.json()).toMatchObject({ awarded: false });

    const second = await award(10_00);
    expect(second.json()).toMatchObject({ awarded: false });

    const third = await award(10_00);
    expect(third.json()).toMatchObject({ points: 50, awarded: true });
    expect(third.json().breakdown[0]).toMatchObject({ type: 'every_nth_visit', applied: true });

    const fourth = await award(10_00);
    expect(fourth.json()).toMatchObject({ awarded: false });

    const balance = await pool.query(
      'SELECT balance FROM points_balances WHERE customer_id = $1 AND store_id = $2',
      [customerId, storeId],
    );
    expect(balance.rows[0].balance).toBe(50);
  });

  it('refuses rules that break the technical limits, and cashiers cannot manage rules', async () => {
    const badRule = await createRule({ type: 'threshold_bonus', points: 20 });
    expect(badRule.statusCode).toBe(400);
    expect(badRule.json()).toEqual({ error: { code: 'INVALID_RULE', message: expect.any(String) } });

    const forbidden = await listRules('cashier@test.dev');
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: { code: 'FORBIDDEN', message: expect.any(String) } });
  });

  it('simulates a draft rule set without writing to the ledger', async () => {
    await pool.query(
      `INSERT INTO earning_rules (store_id, type, params, conditions, effective_from, status, version)
       VALUES ($1, 'per_euro', '{"pointsPerEuroThousandths":1000}', '{}', now(), 'active', 1)`,
      [storeId],
    );
    const draft = await simulate({
      amountCents: 25_00,
      rules: [
        { type: 'per_euro', pointsPerEuroThousandths: 1000 },
        { type: 'fixed_per_purchase', points: 5 },
      ],
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({ points: 30, capped: false, rulesSource: 'draft' });
    expect(draft.json().breakdown).toHaveLength(2);

    const againstStore = await simulate({ amountCents: 25_00 });
    expect(againstStore.json()).toMatchObject({
      points: 25,
      rulesSource: 'store',
      awarded: true,
    });

    const rows = await pool.query("SELECT count(*)::int AS count FROM points_ledger_entries");
    expect(rows.rows[0].count).toBe(0);

    const capped = await simulate({
      amountCents: 25_00,
      rules: [{ type: 'per_euro', pointsPerEuroThousandths: 1000 }],
      // The store's own ceiling applies to drafts too.
    });
    expect(capped.json().points).toBe(25);
  });

  it('applies the store ceiling to a draft simulation', async () => {
    await pool.query('UPDATE stores SET max_points_per_sale = 10 WHERE id = $1', [storeId]);
    await pool.query(
      `INSERT INTO earning_rules (store_id, type, params, conditions, effective_from, status, version)
       VALUES ($1, 'per_euro', '{"pointsPerEuroThousandths":1000}', '{}', now(), 'active', 1)`,
      [storeId],
    );

    const capped = await simulate({
      amountCents: 25_00,
      rules: [{ type: 'per_euro', pointsPerEuroThousandths: 1000 }],
    });
    expect(capped.json()).toMatchObject({ points: 10, capped: true });
    expect(capped.json().uncappedPoints).toBe(25);
  });
});

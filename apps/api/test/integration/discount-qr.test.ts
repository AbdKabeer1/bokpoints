import { createHash, createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import {
  createDevCustomerResolver,
  createDevSessionResolver,
  uuidFromEmail,
} from '../../src/auth/dev-session.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { applyMigrations, truncateAll } from './setup.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

let pool: ReturnType<typeof createPool>;
let db: Database;

let storeId: string;
let customerId: string;
const customerEmail = 'phone@mail.test';

async function inject(
  method: 'GET' | 'POST',
  url: string,
  token: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  const app = await buildApp({
    db,
    sessionResolver: createDevSessionResolver(db),
    customerResolver: createDevCustomerResolver(),
  });
  const res = await app.inject({
    method,
    url,
    headers: {
      ...(token === '' ? {} : { authorization: `Bearer ${token}` }),
      ...(headers ?? {}),
    },
    ...(body === undefined ? {} : { payload: body as object }),
  });
  await app.close();
  return res;
}

const setRule = (body: Record<string, unknown>, token = 'owner@test.dev') =>
  inject('POST', `/v1/stores/${storeId}/discount-rule`, token, body);

const getRule = () => inject('GET', `/v1/stores/${storeId}/discount-rule`, 'owner@test.dev');

const verify = (body: Record<string, unknown>) =>
  inject('POST', `/v1/stores/${storeId}/discount-proof/verify`, 'cashier@test.dev', body);

const award = (key: string, body: Record<string, unknown>) =>
  inject('POST', `/v1/stores/${storeId}/awards`, 'cashier@test.dev', body, {
    'idempotency-key': key,
  });

const issueProof = async () =>
  inject('POST', `/v1/customer/stores/${storeId}/discount-proof`, customerEmail);

/** Crafts a signed proof with an arbitrary payload, like a real client would receive. */
function craftProof(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const key = createHash('sha256').update('dev-discount-proof-secret').digest(); // the dev fallback
  const sig = createHmac('sha256', key).update(body).digest('base64url');
  return `POKDSC.${body}.${sig}`;
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
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'owner@test.dev', 'Otto Owner', false)",
    [randomUUID()],
  );
  await pool.query(
    "INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, 'cashier@test.dev', 'Cai Cashier', false)",
    [randomUUID()],
  );
  await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, 'Discount Store', 'active')", [
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
    'INSERT INTO customers (id, email, name, status, auth_user_id) VALUES ($1, $2, \'Pella Phone\', \'active\', $3)',
    [customerId, customerEmail, uuidFromEmail(customerEmail)],
  );

  // One point per euro; a fixed €2-off discount from a €20 basket.
  const rule = await inject('POST', `/v1/stores/${storeId}/rules`, 'owner@test.dev', {
    definition: { type: 'per_euro', pointsPerEuroThousandths: 1000, rounding: 'floor' },
  });
  expect(rule.statusCode).toBe(201);
  const set = await setRule({ thresholdCents: 2000, kind: 'fixed_cents', value: 200 });
  expect(set.statusCode).toBe(200);
});

describe('the discount rule (D-115, D-131)', () => {
  it('the owner sets it once and reads it back; a cashier cannot set it', async () => {
    const got = await getRule();
    expect(got.statusCode).toBe(200);
    expect(got.json().rule).toMatchObject({
      thresholdCents: 2000,
      kind: 'fixed_cents',
      value: 200,
      active: true,
    });

    const byCashier = await setRule(
      { thresholdCents: 0, kind: 'percent', value: 1000 },
      'cashier@test.dev',
    );
    expect(byCashier.statusCode).toBe(403);
  });

  it('setting again replaces the one rule, and the audit log records what it replaced', async () => {
    const replaced = await setRule({ thresholdCents: 3000, kind: 'percent', value: 5000 });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toMatchObject({ kind: 'percent', value: 5000 });

    const got = await getRule();
    expect(got.json().rule).toMatchObject({ kind: 'percent' });

    const audit = await pool.query(
      "SELECT before, after FROM audit_log_entries WHERE action = 'discount.set' ORDER BY created_at DESC LIMIT 1",
    );
    expect(audit.rows[0].before).toMatchObject({ kind: 'fixed_cents', value: 200 });
    expect(audit.rows[0].after).toMatchObject({ kind: 'percent', value: 5000 });
  });

  it('pausing the rule stops the discount', async () => {
    const paused = await setRule({
      thresholdCents: 2000,
      kind: 'fixed_cents',
      value: 200,
      active: false,
    });
    expect(paused.json().active).toBe(false);

    const proof = await issueProof();
    expect(proof.json().active).toBe(false);
  });
});

describe('the rotating code (D-133)', () => {
  it('the customer gets a fresh, bound, minute-long code', async () => {
    const issued = await issueProof();
    expect(issued.statusCode).toBe(200);
    expect(issued.json().proof).toMatch(/^POKDSC\./);
    const gap = new Date(issued.json().expiresAt).getTime() - Date.now();
    expect(gap).toBeGreaterThan(55_000);
    expect(gap).toBeLessThanOrEqual(61_000);
  });

  it('the till verifies it against the basket', async () => {
    const issued = await issueProof();
    const res = await verify({
      proof: issued.json().proof,
      amountCents: 2500,
      customerId,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: true, discountCents: 200 });
  });

  it('a basket below the threshold verifies as not valid', async () => {
    const issued = await issueProof();
    const res = await verify({
      proof: issued.json().proof,
      amountCents: 1500,
      customerId,
    });
    expect(res.json()).toEqual({ valid: false, reason: 'below_threshold', discountCents: 0 });
  });

  it('an unknown code is not valid', async () => {
    const res = await verify({ proof: 'POKDSC.nonsense.nonsense', amountCents: 2500 });
    expect(res.json()).toEqual({ valid: false, reason: 'invalid', discountCents: 0 });
  });

  it('a code for another store is not valid here', async () => {
    const elsewhere = craftProof({
      customerId,
      storeId: randomUUID(),
      iat: Date.now(),
      jti: randomUUID(),
    });
    const res = await verify({ proof: elsewhere, amountCents: 2500 });
    expect(res.json()).toEqual({ valid: false, reason: 'invalid', discountCents: 0 });
  });

  it('verifying writes nothing — the quote is a dry run', async () => {
    const issued = await issueProof();
    const first = await verify({ proof: issued.json().proof, amountCents: 2500, customerId });
    const second = await verify({ proof: issued.json().proof, amountCents: 2500, customerId });
    expect(first.json().valid).toBe(true);
    expect(second.json().valid).toBe(true);

    const used = await pool.query('SELECT count(*)::int AS n FROM consumed_discount_proofs');
    expect(used.rows[0].n).toBe(0);
  });
});

describe('the confirm consumes the code (D-133)', () => {
  it('the discount lands on the sale, and the points follow what was paid', async () => {
    const issued = await issueProof();
    const res = await award('disc-1', {
      customerId,
      amountCents: 2500,
      amountPaidCents: 2300,
      discountProof: issued.json().proof,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ points: 23, discountCents: 200 });

    const sale = await pool.query('SELECT * FROM sales WHERE id = $1', [res.json().saleId]);
    expect(sale.rows[0]).toMatchObject({
      amount_before_discount_cents: 2500,
      discount_cents: 200,
      amount_paid_cents: 2300,
    });

    const used = await pool.query(
      'SELECT store_id FROM consumed_discount_proofs WHERE jti IS NOT NULL',
    );
    expect(used.rows[0].store_id).toBe(storeId);
  });

  it('a second confirm with the same code is refused', async () => {
    const issued = await issueProof();
    const first = await award('disc-2', {
      customerId,
      amountCents: 2500,
      amountPaidCents: 2300,
      discountProof: issued.json().proof,
    });
    expect(first.statusCode).toBe(201);

    const again = await award('disc-3', {
      customerId,
      amountCents: 2500,
      amountPaidCents: 2300,
      discountProof: issued.json().proof,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({
      error: { code: 'PROOF_ALREADY_USED', message: expect.any(String) },
    });
  });

  it('a replayed confirm echoes the same discount and stays one sale', async () => {
    const issued = await issueProof();
    const body = {
      customerId,
      amountCents: 2500,
      amountPaidCents: 2300,
      discountProof: issued.json().proof,
    };
    const first = await award('disc-4', body);
    const second = await award('disc-4', body);
    expect(second.json().entryId).toBe(first.json().entryId);
    expect(second.json().discountCents).toBe(200);
  });

  it('the customer cannot pay more than the discounted total', async () => {
    const issued = await issueProof();
    const res = await award('disc-5', {
      customerId,
      amountCents: 2500,
      amountPaidCents: 2400,
      discountProof: issued.json().proof,
    });
    expect(res.statusCode).toBe(400);
  });

  it('an expired code is refused', async () => {
    const expired = craftProof({
      customerId,
      storeId,
      iat: Date.now() - 61_000,
      jti: randomUUID(),
    });
    const res = await award('disc-6', {
      customerId,
      amountCents: 2500,
      amountPaidCents: 2300,
      discountProof: expired,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: 'PROOF_EXPIRED', message: expect.any(String) },
    });
  });

  it('a code for another customer is refused', async () => {
    const stranger = craftProof({
      customerId: randomUUID(),
      storeId,
      iat: Date.now(),
      jti: randomUUID(),
    });
    const res = await award('disc-7', {
      customerId,
      amountCents: 2500,
      amountPaidCents: 2300,
      discountProof: stranger,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'PROOF_CUSTOMER_MISMATCH', message: expect.any(String) },
    });
  });

  it('a code for another store is refused', async () => {
    const elsewhere = craftProof({
      customerId,
      storeId: randomUUID(),
      iat: Date.now(),
      jti: randomUUID(),
    });
    const res = await award('disc-8', {
      customerId,
      amountCents: 2500,
      amountPaidCents: 2300,
      discountProof: elsewhere,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'PROOF_STORE_MISMATCH', message: expect.any(String) },
    });
  });

  it('with the rule paused, a fresh code buys nothing', async () => {
    await setRule({ thresholdCents: 2000, kind: 'fixed_cents', value: 200, active: false });
    const issued = await issueProof();
    const res = await award('disc-9', {
      customerId,
      amountCents: 2500,
      amountPaidCents: 2500,
      discountProof: issued.json().proof,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('the percent kind', () => {
  it('takes its percent off the basket', async () => {
    await setRule({ thresholdCents: 2000, kind: 'percent', value: 5000 }); // 5%
    const issued = await issueProof();
    const res = await verify({
      proof: issued.json().proof,
      amountCents: 2500,
      customerId,
    });
    expect(res.json()).toEqual({ valid: true, discountCents: 125 });
  });
});

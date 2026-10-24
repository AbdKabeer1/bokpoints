import { randomUUID } from 'node:crypto';
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
let consentedId: string;
let quietId: string;

const CONSENTED = 'consented@test.dev';
const QUIET = 'quiet@test.dev';

async function inject(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  token: string,
  body?: unknown,
) {
  const app = await buildApp({
    db,
    sessionResolver: createDevSessionResolver(db),
    customerResolver: createDevCustomerResolver(),
  });
  const res = await app.inject({
    method,
    url,
    headers: token === '' ? {} : { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { payload: body as object }),
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
  consentedId = uuidFromEmail(CONSENTED);
  quietId = uuidFromEmail(QUIET);

  for (const [email, name, admin] of [
    ['owner@test.dev', 'Otto Owner', false],
    ['cashier@test.dev', 'Cai Cashier', false],
  ] as const) {
    await pool.query(
      'INSERT INTO staff_users (id, email, name, is_admin) VALUES ($1, $2, $3, $4)',
      [randomUUID(), email, name, admin],
    );
  }

  await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, 'Campaign Store', 'active')", [
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
    "INSERT INTO customers (id, email, name, status) VALUES ($1, $2, 'Aino Consented', 'active')",
    [consentedId, CONSENTED],
  );
  await pool.query(
    "INSERT INTO customers (id, email, name, status) VALUES ($1, $2, 'Pekka Quiet', 'active')",
    [quietId, QUIET],
  );

  await pool.query(
    `INSERT INTO customer_store_links (customer_id, store_id, marketing_consent)
     VALUES ($1, $2, true), ($3, $2, false)`,
    [consentedId, storeId, quietId],
  );
});

describe('the campaign audience', () => {
  it('counts linked customers and those who opted in', async () => {
    const res = await inject('GET', `/v1/stores/${storeId}/campaigns/audience`, 'owner@test.dev');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ linked: 2, optedIn: 1 });
  });

  it('is closed to a cashier', async () => {
    const res = await inject('GET', `/v1/stores/${storeId}/campaigns/audience`, 'cashier@test.dev');
    expect(res.statusCode).toBe(403);
  });
});

describe('sending a campaign', () => {
  it('delivers only to consenting customers and records the send', async () => {
    const sent = await inject('POST', `/v1/stores/${storeId}/campaigns`, 'owner@test.dev', {
      title: 'Double points Saturday',
      body: 'Come in before 18:00 and earn twice the points.',
    });

    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ recipients: 1, opened: 0, status: 'sent' });

    const delivered = await pool.query(
      'SELECT customer_id FROM campaign_deliveries ORDER BY customer_id',
    );
    expect(delivered.rows.map((row: { customer_id: string }) => row.customer_id)).toEqual([
      consentedId,
    ]);

    const audit = await pool.query(
      "SELECT after FROM audit_log_entries WHERE action = 'campaign.send'",
    );
    expect(audit.rows[0].after).toMatchObject({ recipients: 1 });

    const list = await inject('GET', `/v1/stores/${storeId}/campaigns`, 'owner@test.dev');
    expect(list.statusCode).toBe(200);
    expect(list.json().campaigns).toHaveLength(1);
    expect(list.json().campaigns[0]).toMatchObject({
      title: 'Double points Saturday',
      recipients: 1,
    });
  });

  it('refuses an empty title, an empty body, and a cashier', async () => {
    const noTitle = await inject('POST', `/v1/stores/${storeId}/campaigns`, 'owner@test.dev', {
      title: '   ',
      body: 'Something',
    });
    expect(noTitle.statusCode).toBe(400);

    const noBody = await inject('POST', `/v1/stores/${storeId}/campaigns`, 'owner@test.dev', {
      title: 'Hello',
      body: '',
    });
    expect(noBody.statusCode).toBe(400);

    const cashier = await inject('POST', `/v1/stores/${storeId}/campaigns`, 'cashier@test.dev', {
      title: 'Hello',
      body: 'Something',
    });
    expect(cashier.statusCode).toBe(403);
  });

  it('sends to both once the quiet customer opts in', async () => {
    const consent = await inject(
      'PATCH',
      `/v1/customer/me/stores/${storeId}/consent`,
      QUIET,
      { marketingConsent: true },
    );
    expect(consent.statusCode).toBe(200);
    expect(consent.json()).toEqual({ storeId, marketingConsent: true });

    const sent = await inject('POST', `/v1/stores/${storeId}/campaigns`, 'owner@test.dev', {
      title: 'Weekend offer',
      body: 'Two for one on Saturday.',
    });
    expect(sent.json().recipients).toBe(2);
  });
});

describe('the customer inbox', () => {
  async function sendOne(): Promise<string> {
    const sent = await inject('POST', `/v1/stores/${storeId}/campaigns`, 'owner@test.dev', {
      title: 'A free coffee',
      body: 'Show this at the counter this week.',
    });
    expect(sent.statusCode).toBe(201);
    const row = await pool.query('SELECT id FROM campaign_deliveries LIMIT 1');
    return row.rows[0].id as string;
  }

  it('shows the message, marks it read, and the store sees the open', async () => {
    const notificationId = await sendOne();

    const inbox = await inject('GET', '/v1/customer/me/notifications', CONSENTED);
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json().unread).toBe(1);
    expect(inbox.json().notifications[0]).toMatchObject({
      title: 'A free coffee',
      storeName: 'Campaign Store',
      readAt: null,
    });

    const read = await inject(
      'POST',
      `/v1/customer/me/notifications/${notificationId}/read`,
      CONSENTED,
    );
    expect(read.statusCode).toBe(200);
    expect(read.json().id).toBe(notificationId);

    const after = await inject('GET', '/v1/customer/me/notifications', CONSENTED);
    expect(after.json().unread).toBe(0);

    const list = await inject('GET', `/v1/stores/${storeId}/campaigns`, 'owner@test.dev');
    expect(list.json().campaigns[0].opened).toBe(1);
  });

  it('a customer who did not receive it cannot mark it read', async () => {
    const notificationId = await sendOne();
    const refused = await inject(
      'POST',
      `/v1/customer/me/notifications/${notificationId}/read`,
      QUIET,
    );
    expect(refused.statusCode).toBe(404);

    const inbox = await inject('GET', '/v1/customer/me/notifications', QUIET);
    expect(inbox.json().notifications).toHaveLength(0);
  });

  it('consent cannot be changed for a store the customer never joined', async () => {
    const res = await inject(
      'PATCH',
      `/v1/customer/me/stores/${randomUUID()}/consent`,
      CONSENTED,
      { marketingConsent: true },
    );
    expect(res.statusCode).toBe(404);
  });
});

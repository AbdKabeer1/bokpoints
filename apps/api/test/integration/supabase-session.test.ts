import { randomUUID } from 'node:crypto';
import {
  createLocalJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
  type JWTVerifyGetKey,
} from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createSupabaseSessionResolver } from '../../src/auth/supabase-session.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { upsertStaffAccount } from '../../src/db/staff.js';
import { applyMigrations, truncateAll } from './setup.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

const SUPABASE_URL = 'https://test-project.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

let pool: ReturnType<typeof createPool>;
let db: Database;
let privateKey: CryptoKey;
let keys: JWTVerifyGetKey;

let storeA: string;
let storeB: string;
let customerId: string;
const cashierAuthId = randomUUID();
const adminAuthId = randomUUID();
const customerAuthId = randomUUID();
const deactivatedAuthId = randomUUID();

interface TokenOptions {
  sub?: string | undefined;
  aal?: string | undefined;
  iss?: string;
  aud?: string;
  exp?: number | string;
  kid?: string;
  key?: CryptoKey | Uint8Array;
  alg?: string;
}

async function makeToken(options: TokenOptions = {}): Promise<string> {
  const jwt = new SignJWT({ aal: options.aal ?? 'aal2', role: 'authenticated' })
    .setProtectedHeader({ alg: options.alg ?? 'ES256', kid: options.kid ?? 'key-1' })
    .setIssuer(options.iss ?? ISSUER)
    .setAudience(options.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(options.exp ?? '5m');
  if ('sub' in options ? options.sub !== undefined : true) {
    jwt.setSubject(options.sub ?? cashierAuthId);
  }
  return jwt.sign(options.key ?? privateKey);
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function makeResolver(customKeys?: JWTVerifyGetKey) {
  return createSupabaseSessionResolver({ db, supabaseUrl: SUPABASE_URL, keys: customKeys ?? keys });
}

beforeAll(async () => {
  pool = createPool(DATABASE_URL);
  await applyMigrations(pool);
  db = createDb(pool);

  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'key-1', alg: 'ES256', use: 'sig' };
  keys = createLocalJWKSet({ keys: [jwk] });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);

  storeA = randomUUID();
  storeB = randomUUID();
  customerId = randomUUID();

  await pool.query(
    "INSERT INTO stores (id, name, status) VALUES ($1, 'Store A', 'active'), ($2, 'Store B', 'active')",
    [storeA, storeB],
  );
  await pool.query(
    `INSERT INTO points_rules (store_id, rule_version, points_per_euro_thousandths, rounding, active_from)
     VALUES ($1, 1, 1000, 'floor', now()), ($2, 1, 1000, 'floor', now())`,
    [storeA, storeB],
  );
  await pool.query('INSERT INTO customers (id, email, name) VALUES ($1, $2, $3)', [
    customerId,
    'customer@test.dev',
    'Aino Virtanen',
  ]);

  const cashier = await upsertStaffAccount(db, {
    email: 'cashier@test.dev',
    name: 'Cashier',
    authUserId: cashierAuthId,
    isAdmin: false,
  });
  await pool.query(
    "INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, 'cashier')",
    [storeA, cashier],
  );
  await upsertStaffAccount(db, {
    email: 'admin@test.dev',
    name: 'Admin',
    authUserId: adminAuthId,
    isAdmin: true,
  });
  const deactivated = await upsertStaffAccount(db, {
    email: 'gone@test.dev',
    name: 'Gone',
    authUserId: deactivatedAuthId,
    isAdmin: false,
  });
  await pool.query("UPDATE staff_users SET status = 'deactivated' WHERE id = $1", [deactivated]);
  await pool.query(
    "INSERT INTO store_members (store_id, user_id, role) VALUES ($1, $2, 'cashier')",
    [storeA, deactivated],
  );
});

describe('Supabase session resolver (D-098 to D-101)', () => {
  it('resolves a valid second-factor token to the linked staff account', async () => {
    const principal = await makeResolver().resolve(await makeToken());
    expect(principal).toMatchObject({ email: 'cashier@test.dev' });
  });

  it('takes the email from our own record, not from the token', async () => {
    const token = await new SignJWT({ aal: 'aal2', email: 'someone-else@evil.test' })
      .setProtectedHeader({ alg: 'ES256', kid: 'key-1' })
      .setSubject(cashierAuthId)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(privateKey);

    expect(await makeResolver().resolve(token)).toMatchObject({ email: 'cashier@test.dev' });
  });

  it('refuses a token that has not passed MFA, for a staff member (MFA_REQUIRED)', async () => {
    await expect(makeResolver().resolve(await makeToken({ aal: 'aal1' }))).rejects.toMatchObject({
      name: 'MfaRequiredError',
    });
  });

  it('refuses a token with no aal claim at all', async () => {
    await expect(makeResolver().resolve(await makeToken({ aal: '' }))).rejects.toMatchObject({
      name: 'MfaRequiredError',
    });
  });

  it('treats an ordinary customer sign-in as simply not valid, not as an MFA prompt', async () => {
    const token = await makeToken({ sub: customerAuthId, aal: 'aal1' });
    expect(await makeResolver().resolve(token)).toBeNull();
  });

  it('refuses a user with no linked staff account', async () => {
    expect(await makeResolver().resolve(await makeToken({ sub: randomUUID() }))).toBeNull();
  });

  it('refuses an expired token', async () => {
    const expired = Math.floor(Date.now() / 1000) - 60;
    expect(await makeResolver().resolve(await makeToken({ exp: expired }))).toBeNull();
  });

  it('refuses the wrong issuer', async () => {
    const token = await makeToken({ iss: 'https://other-project.supabase.co/auth/v1' });
    expect(await makeResolver().resolve(token)).toBeNull();
  });

  it('refuses the wrong audience', async () => {
    expect(await makeResolver().resolve(await makeToken({ aud: 'anon' }))).toBeNull();
  });

  it('refuses a token signed by a different key', async () => {
    const other = await generateKeyPair('ES256');
    expect(await makeResolver().resolve(await makeToken({ key: other.privateKey }))).toBeNull();
  });

  it('refuses a token naming a key we do not have', async () => {
    expect(await makeResolver().resolve(await makeToken({ kid: 'unknown-key' }))).toBeNull();
  });

  it('refuses a shared-secret (HS256) token outright', async () => {
    const secret = new TextEncoder().encode('a-shared-secret-of-at-least-32-bytes!!');
    const token = await makeToken({ alg: 'HS256', key: secret });
    expect(await makeResolver().resolve(token)).toBeNull();
  });

  it('refuses a token with no subject, and one that is not a UUID', async () => {
    expect(await makeResolver().resolve(await makeToken({ sub: undefined }))).toBeNull();
    expect(
      await makeResolver().resolve(await makeToken({ sub: "x'; DROP TABLE staff_users;--" })),
    ).toBeNull();
  });

  it('refuses garbage', async () => {
    expect(await makeResolver().resolve('not-a-token')).toBeNull();
    expect(await makeResolver().resolve('a.b.c')).toBeNull();
  });

  it('does not report an outage reaching the keys as an invalid token', async () => {
    const down: JWTVerifyGetKey = async () => {
      throw new errors.JWKSTimeout();
    };
    await expect(makeResolver(down).resolve(await makeToken())).rejects.toThrow();

    const broken: JWTVerifyGetKey = async () => {
      throw new Error('network down');
    };
    await expect(makeResolver(broken).resolve(await makeToken())).rejects.toThrow('network down');
  });
});

describe('the API with real Supabase tokens', () => {
  const app = () => buildApp({ db, sessionResolver: makeResolver() });

  const award = async (token: string, storeId = storeA) => {
    const instance = await app();
    const res = await instance.inject({
      method: 'POST',
      url: `/v1/stores/${storeId}/awards`,
      headers: { ...bearer(token), 'idempotency-key': randomUUID() },
      payload: { customerId, amountCents: 2380 },
    });
    await instance.close();
    return res;
  };

  it('lets a cashier with a second-factor token award points', async () => {
    const res = await award(await makeToken());
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ points: 23, awarded: true });
  });

  it('answers 403 MFA_REQUIRED for a staff token without the second factor', async () => {
    const res = await award(await makeToken({ aal: 'aal1' }));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'MFA_REQUIRED' } });
  });

  it('answers 401 for a customer-style sign-in on a staff endpoint', async () => {
    const res = await award(await makeToken({ sub: customerAuthId, aal: 'aal1' }));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'INVALID_TOKEN' } });
  });

  it('refuses a deactivated account even with a perfect token', async () => {
    const res = await award(await makeToken({ sub: deactivatedAuthId }));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'ACCOUNT_DEACTIVATED' } });
  });

  it('keeps store isolation: a member of Store A cannot award at Store B', async () => {
    const res = await award(await makeToken(), storeB);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'STORE_MISMATCH' } });
  });

  it('does not let an admin award points, token or not', async () => {
    const res = await award(await makeToken({ sub: adminAuthId }));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
});

describe('upsertStaffAccount', () => {
  it('creates an account and is a no-op when run again', async () => {
    const authUserId = randomUUID();
    const input = { email: 'First.Admin@test.dev', name: 'First Admin', authUserId, isAdmin: true };

    const first = await upsertStaffAccount(db, input);
    const second = await upsertStaffAccount(db, input);

    expect(second).toBe(first);
    const rows = await pool.query(
      "SELECT is_admin, auth_user_id FROM staff_users WHERE lower(email) = 'first.admin@test.dev'",
    );
    expect(rows.rows).toEqual([{ is_admin: true, auth_user_id: authUserId }]);
  });

  it('matches the email case-insensitively and links the Supabase user to the existing row', async () => {
    const before = await pool.query("SELECT id FROM staff_users WHERE email = 'cashier@test.dev'");
    const newAuthId = randomUUID();

    const id = await upsertStaffAccount(db, {
      email: 'CASHIER@test.dev',
      name: 'Cashier',
      authUserId: newAuthId,
      isAdmin: false,
    });

    expect(id).toBe(before.rows[0].id);
    const after = await pool.query('SELECT auth_user_id FROM staff_users WHERE id = $1', [id]);
    expect(after.rows[0].auth_user_id).toBe(newAuthId);
  });

  it('refuses to link one Supabase user to two staff accounts', async () => {
    await expect(
      upsertStaffAccount(db, {
        email: 'second@test.dev',
        name: 'Second',
        authUserId: cashierAuthId,
        isAdmin: false,
      }),
    ).rejects.toThrow();
  });
});

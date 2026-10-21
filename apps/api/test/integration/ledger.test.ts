import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import {
  getBalance,
  LedgerError,
  recordAdjust,
  recordEarn,
  recordFraudClawback,
} from '../../src/db/ledger.js';
import { customerStoreLinks, pointsLedgerEntries } from '../../src/db/schema.js';
import { applyMigrations, truncateAll } from './setup.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

let pool: Pool;
let db: Database;

const onePointPerEuro = { pointsPerEuroThousandths: 1000 };

async function makeCustomer(email = `c-${randomUUID()}@t.dev`) {
  const id = randomUUID();
  await pool.query('INSERT INTO customers (id, email, name) VALUES ($1, $2, $3)', [
    id,
    email,
    'Test Customer',
  ]);
  return id;
}

async function makeStore(name = `S-${randomUUID()}`) {
  const id = randomUUID();
  await pool.query('INSERT INTO stores (id, name) VALUES ($1, $2)', [id, name]);
  return id;
}

async function makeStaff(email = `s-${randomUUID()}@t.dev`) {
  const id = randomUUID();
  await pool.query('INSERT INTO staff_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    email,
    'Test Staff',
  ]);
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
});

describe('recordEarn', () => {
  it('awards points and updates the balance in one step (AC-1)', async () => {
    const customerId = await makeCustomer();
    const storeId = await makeStore();

    const result = await recordEarn(db, {
      customerId,
      storeId,
      amountCents: 2380,
      rule: onePointPerEuro,
      ruleVersion: 1,
      idempotencyKey: 'key-1',
    });

    expect(result.awarded).toBe(true);
    expect(result.points).toBe(23);
    expect(await getBalance(db, customerId, storeId)).toBe(23);
  });

  it('never awards twice for the same idempotency key (AC-2)', async () => {
    const customerId = await makeCustomer();
    const storeId = await makeStore();

    const first = await recordEarn(db, {
      customerId,
      storeId,
      amountCents: 2380,
      rule: onePointPerEuro,
      ruleVersion: 1,
      idempotencyKey: 'retry-key',
    });
    const second = await recordEarn(db, {
      customerId,
      storeId,
      amountCents: 2380,
      rule: onePointPerEuro,
      ruleVersion: 1,
      idempotencyKey: 'retry-key',
    });

    expect(second.entryId).toBe(first.entryId);
    expect(await getBalance(db, customerId, storeId)).toBe(23);

    const rows = await pool.query(
      'SELECT count(*)::int AS count FROM points_ledger_entries WHERE idempotency_key = $1',
      ['retry-key'],
    );
    expect(rows.rows[0].count).toBe(1);
  });

  it('scopes the idempotency key to the store, so another store is a separate award', async () => {
    const customerId = await makeCustomer();
    const storeA = await makeStore();
    const storeB = await makeStore();

    await recordEarn(db, {
      customerId,
      storeId: storeA,
      amountCents: 1000,
      rule: onePointPerEuro,
      ruleVersion: 1,
      idempotencyKey: 'shared-key',
    });
    const atB = await recordEarn(db, {
      customerId,
      storeId: storeB,
      amountCents: 1000,
      rule: onePointPerEuro,
      ruleVersion: 1,
      idempotencyKey: 'shared-key',
    });

    expect(atB.awarded).toBe(true);
    expect(await getBalance(db, customerId, storeA)).toBe(10);
    expect(await getBalance(db, customerId, storeB)).toBe(10);
  });

  it('awards zero points and explains why when the amount is below the minimum (FR-PTS-2)', async () => {
    const customerId = await makeCustomer();
    const storeId = await makeStore();

    const result = await recordEarn(db, {
      customerId,
      storeId,
      amountCents: 999,
      rule: { ...onePointPerEuro, minPurchaseCents: 1000 },
      ruleVersion: 1,
      idempotencyKey: 'below-min',
    });

    expect(result.awarded).toBe(false);
    expect(result.points).toBe(0);
    expect(result.reason).toBe('below_minimum');
    expect(await getBalance(db, customerId, storeId)).toBe(0);
  });

  it('creates the customer-store link on the first purchase (FRD 4.3)', async () => {
    const customerId = await makeCustomer();
    const storeId = await makeStore();

    await recordEarn(db, {
      customerId,
      storeId,
      amountCents: 1000,
      rule: onePointPerEuro,
      ruleVersion: 1,
      idempotencyKey: 'first-purchase',
    });

    const links = await db
      .select()
      .from(customerStoreLinks)
      .where(eq(customerStoreLinks.customerId, customerId));
    expect(links).toHaveLength(1);
    expect(links[0]?.storeId).toBe(storeId);
  });

  it('writes nothing when the balance update fails (FR-PTS-5)', async () => {
    const customerId = await makeCustomer();
    const storeId = await makeStore();

    // Force the balance write to fail after the ledger insert.
    await pool.query(`
      CREATE OR REPLACE FUNCTION fail_balance_update() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'simulated balance failure';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await pool.query(`
      CREATE TRIGGER fail_balance_update_trigger
      BEFORE INSERT OR UPDATE ON points_balances
      FOR EACH ROW EXECUTE FUNCTION fail_balance_update();
    `);

    try {
      let caught: unknown;
      try {
        await recordEarn(db, {
          customerId,
          storeId,
          amountCents: 2380,
          rule: onePointPerEuro,
          ruleVersion: 1,
          idempotencyKey: 'atomic-key',
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);

      // Drizzle wraps the driver error, so walk the cause chain to find the
      // simulated failure.
      const messages: string[] = [];
      let cursor: unknown = caught;
      while (cursor instanceof Error) {
        messages.push(cursor.message);
        cursor = (cursor as { cause?: unknown }).cause;
      }
      expect(messages.join('\n')).toContain('simulated balance failure');
    } finally {
      // Always remove the trigger, even if the assertion above fails, so it
      // cannot leak into the next test.
      await pool.query('DROP TRIGGER IF EXISTS fail_balance_update_trigger ON points_balances;');
    }

    const entries = await pool.query(
      'SELECT count(*)::int AS count FROM points_ledger_entries WHERE idempotency_key = $1',
      ['atomic-key'],
    );
    expect(entries.rows[0].count).toBe(0);
    expect(await getBalance(db, customerId, storeId)).toBe(0);
  });
});

describe('store isolation', () => {
  it('keeps each store balance separate (AC-3)', async () => {
    const customerId = await makeCustomer();
    const storeA = await makeStore();
    const storeB = await makeStore();

    await recordEarn(db, {
      customerId,
      storeId: storeA,
      amountCents: 2380,
      rule: onePointPerEuro,
      ruleVersion: 1,
      idempotencyKey: 'iso-a',
    });
    await recordEarn(db, {
      customerId,
      storeId: storeB,
      amountCents: 1000,
      rule: onePointPerEuro,
      ruleVersion: 1,
      idempotencyKey: 'iso-b',
    });

    expect(await getBalance(db, customerId, storeA)).toBe(23);
    expect(await getBalance(db, customerId, storeB)).toBe(10);

    const storeAEntries = await db
      .select()
      .from(pointsLedgerEntries)
      .where(eq(pointsLedgerEntries.storeId, storeA));
    expect(storeAEntries).toHaveLength(1);
    expect(storeAEntries[0]?.points).toBe(23);
  });
});

describe('recordAdjust', () => {
  it('removes points while the balance stays at or above zero', async () => {
    const customerId = await makeCustomer();
    const storeId = await makeStore();

    await recordEarn(db, {
      customerId,
      storeId,
      amountCents: 1000,
      rule: onePointPerEuro,
      ruleVersion: 1,
      idempotencyKey: 'adj-base',
    });

    const result = await recordAdjust(db, {
      customerId,
      storeId,
      points: -5,
      reason: 'Cashier entered the wrong amount',
      staffId: await makeStaff(),
    });

    expect(result.balance).toBe(5);
    expect(await getBalance(db, customerId, storeId)).toBe(5);
  });

  it('refuses a removal that would take the balance below zero (AC-11)', async () => {
    const customerId = await makeCustomer();
    const storeId = await makeStore();

    await recordEarn(db, {
      customerId,
      storeId,
      amountCents: 500,
      rule: onePointPerEuro,
      ruleVersion: 1,
      idempotencyKey: 'adj-base-5',
    });

    await expect(
      recordAdjust(db, {
        customerId,
        storeId,
        points: -8,
        reason: 'too many',
        staffId: await makeStaff(),
      }),
    ).rejects.toThrow(LedgerError);

    expect(await getBalance(db, customerId, storeId)).toBe(5);
    const entries = await pool.query(
      "SELECT count(*)::int AS count FROM points_ledger_entries WHERE type = 'adjust'",
    );
    expect(entries.rows[0].count).toBe(0);
  });

  it('requires a reason', async () => {
    const customerId = await makeCustomer();
    const storeId = await makeStore();

    await expect(
      recordAdjust(db, {
        customerId,
        storeId,
        points: 5,
        reason: '',
        staffId: await makeStaff(),
      }),
    ).rejects.toThrow(LedgerError);
  });
});

describe('recordFraudClawback', () => {
  it('may take the balance below zero and marks the link under fraud review (AC-11)', async () => {
    const customerId = await makeCustomer();
    const storeId = await makeStore();

    await recordEarn(db, {
      customerId,
      storeId,
      amountCents: 500,
      rule: onePointPerEuro,
      ruleVersion: 1,
      idempotencyKey: 'claw-base',
    });

    const result = await recordFraudClawback(db, {
      customerId,
      storeId,
      points: -8,
      caseNote: 'Case 2026-11: points awarded without a purchase',
      staffId: await makeStaff(),
    });

    expect(result.balance).toBe(-3);
    expect(await getBalance(db, customerId, storeId)).toBe(-3);

    const links = await db
      .select()
      .from(customerStoreLinks)
      .where(eq(customerStoreLinks.customerId, customerId));
    expect(links[0]?.status).toBe('under_fraud_review');
  });

  it('requires a case note', async () => {
    const customerId = await makeCustomer();
    const storeId = await makeStore();

    await expect(
      recordFraudClawback(db, {
        customerId,
        storeId,
        points: -8,
        caseNote: '',
        staffId: await makeStaff(),
      }),
    ).rejects.toThrow(LedgerError);
  });
});

describe('the ledger is append-only', () => {
  it('refuses an update to a ledger entry (FR-AUD-2)', async () => {
    const customerId = await makeCustomer();
    const storeId = await makeStore();

    await recordEarn(db, {
      customerId,
      storeId,
      amountCents: 1000,
      rule: onePointPerEuro,
      ruleVersion: 1,
      idempotencyKey: 'immutable',
    });

    await expect(pool.query('UPDATE points_ledger_entries SET points = 999')).rejects.toThrow(
      /append-only/,
    );
  });
});

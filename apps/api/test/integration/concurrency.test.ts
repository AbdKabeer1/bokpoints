import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { LedgerError, recordAdjust, recordEarn } from '../../src/db/ledger.js';
import { pointsBatches } from '../../src/db/schema.js';
import { applyMigrations, truncateAll } from './setup.js';
import { eq } from 'drizzle-orm';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

let pool: ReturnType<typeof createPool>;
let db: Database;

const onePointPerEuro = { pointsPerEuroThousandths: 1000 };

async function makeCustomer() {
  const id = randomUUID();
  await pool.query('INSERT INTO customers (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `c-${randomUUID()}@t.dev`,
    'Test Customer',
  ]);
  return id;
}

async function makeStore() {
  const id = randomUUID();
  await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, $2, 'active')", [
    id,
    `S-${randomUUID()}`,
  ]);
  return id;
}

async function makeStaff() {
  const id = randomUUID();
  await pool.query('INSERT INTO staff_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `s-${randomUUID()}@t.dev`,
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

describe('recordEarn under contention', () => {
  it('refuses the loser of a sure-race when the amounts differ (D-092, AC-2)', async () => {
    const customerId = await makeCustomer();
    const storeId = await makeStore();

    // Two awards fire at the same instant with the same key but a
    // different amount. Exactly one creates the award; the other must
    // answer 409 IDEMPOTENCY_KEY_REUSED, never replay the winner.
    const [a, b] = await Promise.allSettled([
      recordEarn(db, {
        customerId,
        storeId,
        amountCents: 100,
        rule: onePointPerEuro,
        ruleVersion: 1,
        idempotencyKey: 'race-key',
      }),
      recordEarn(db, {
        customerId,
        storeId,
        amountCents: 200,
        rule: onePointPerEuro,
        ruleVersion: 1,
        idempotencyKey: 'race-key',
      }),
    ]);

    // One entry, not two.
    const rows = await pool.query(
      'SELECT count(*)::int AS count FROM points_ledger_entries WHERE idempotency_key = $1',
      ['race-key'],
    );
    expect(rows.rows[0].count).toBe(1);

    // It does not matter which request wins: exactly one creates the
    // award, and the other is refused with the ledger's own typed error,
    // never a replay of the winner with a different amount.
    const outcomes = [a, b];
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const loser = outcomes.find((o) => o.status === 'rejected');
    expect(loser).toBeTruthy();
    if (loser) {
      expect(loser.reason).toBeInstanceOf(LedgerError);
      expect((loser.reason as LedgerError).code).toBe('IDEMPOTENCY_KEY_REUSED');
    }
  });

  it('returns the winner replayed when the amounts match (AC-2)', async () => {
    const customerId = await makeCustomer();
    const storeId = await makeStore();

    const [a, b] = await Promise.allSettled([
      recordEarn(db, {
        customerId,
        storeId,
        amountCents: 2380,
        rule: onePointPerEuro,
        ruleVersion: 1,
        idempotencyKey: 'race-key-same',
      }),
      recordEarn(db, {
        customerId,
        storeId,
        amountCents: 2380,
        rule: onePointPerEuro,
        ruleVersion: 1,
        idempotencyKey: 'race-key-same',
      }),
    ]);

    const rows = await pool.query(
      'SELECT count(*)::int AS count FROM points_ledger_entries WHERE idempotency_key = $1',
      ['race-key-same'],
    );
    expect(rows.rows[0].count).toBe(1);

    // Both may produce a success (one created, one replayed; the order
    // does not matter), and neither may throw.
    expect(a.status === 'rejected' || b.status === 'rejected').toBe(false);
  });
});

describe('recordAdjust under batch contention', () => {
  for (let trial = 0; trial < 12; trial += 1) {
    it(`trial ${trial + 1}: concurrent adjustments never produce a raw constraint error (FR-PTS-8)`, async () => {
      const customerId = await makeCustomer();
      const storeId = await makeStore();
      const staffId = await makeStaff();

      // 40 batched points, 30 unbatched, balance 70.
      await recordEarn(db, {
        customerId,
        storeId,
        amountCents: 4000,
        rule: onePointPerEuro,
        ruleVersion: 1,
        idempotencyKey: `seed-${trial}`,
      });
      await recordAdjust(db, {
        customerId,
        storeId,
        points: 30,
        reason: 'seed unbached points',
        staffId,
      });

      const [a, b] = await Promise.allSettled([
        recordAdjust(db, {
          customerId,
          storeId,
          points: -30,
          reason: 'adjust A',
          staffId,
        }),
        recordAdjust(db, {
          customerId,
          storeId,
          points: -35,
          reason: 'adjust B',
          staffId,
        }),
      ]);

      // Every rejection must be the ledger's own typed refusal, never a
      // raw database constraint error surfacing as a 500.
      for (const outcome of [a, b]) {
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toBeInstanceOf(LedgerError);
          expect((outcome.reason as LedgerError).code).toBe('BALANCE_WOULD_GO_NEGATIVE');
        }
      }
      // The balance covers both draws, so with the rows locked both must
      // succeed; a typed refusal is still tolerated in principle, but a
      // crash-level failure is not.
      expect(a.status).toBe('fulfilled');
      expect(b.status).toBe('fulfilled');

      // The batches keep their invariant after every race.
      const rows = await db
        .select({ remaining: pointsBatches.remainingPoints })
        .from(pointsBatches)
        .where(eq(pointsBatches.customerId, customerId));
      for (const row of rows) {
        expect(row.remaining).toBeGreaterThanOrEqual(0);
      }
    });
  }
});

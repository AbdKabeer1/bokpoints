import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../../src/db/client.js';
import { applyMigrations, truncateAll } from './setup.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

let pool: ReturnType<typeof createPool>;

beforeAll(async () => {
  pool = createPool(DATABASE_URL);
  await applyMigrations(pool);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
  await pool.query("INSERT INTO stores (id, name, status) VALUES ($1, $2, 'active')", [
    randomUUID(),
    'Rate Bound Store',
  ]);
});

describe('points rule rate bound (D-093)', () => {
  async function insertRuleWithRate(rate: number) {
    await pool.query(
      `INSERT INTO points_rules (store_id, rule_version, points_per_euro_thousandths, rounding, active_from)
       SELECT id, 1, $1, 'floor', now() FROM stores LIMIT 1`,
      [rate],
    );
  }

  it('accepts the highest exact rate (1,000,000 thousandths per euro)', async () => {
    await expect(Promise.resolve(insertRuleWithRate(1_000_000))).resolves.toBeUndefined();
  });

  it('refuses a rate above the bound on a €1,000,000-cap transaction', async () => {
    // Above this bound the points multiplication on the largest accepted
    // purchase stops being exactly representable and the award can walk
    // past the int4 points column.
    await expect(insertRuleWithRate(2_000_000)).rejects.toThrow(/rate_check/);
  });
});

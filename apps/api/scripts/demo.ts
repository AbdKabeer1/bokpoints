/**
 * A seeded end-to-end walkthrough of the points engine and the ledger write
 * path, against the real database. Nothing here is mocked: it calls the same
 * functions the API will call.
 *
 * Run with: pnpm demo
 *
 * All data is fake and is deleted again when the script finishes.
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { expiryDateForEarn } from '@bokpoints/shared';
import { createDb, createPool } from '../src/db/client.js';
import { getBalance, recordAdjust, recordEarn, recordFraudClawback } from '../src/db/ledger.js';
import { applyMigrations, truncateAll } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';

const DEMO_DB = 'bokpoints_demo';
const DATABASE_URL =
  process.env.DEMO_DATABASE_URL ??
  `postgres://postgres:postgres@localhost:5432/${DEMO_DB}`;

const admin = createPool('postgres://postgres:postgres@localhost:5432/postgres');
await admin.query(`CREATE DATABASE ${DEMO_DB}`).catch(() => {
  /* already exists */
});
await admin.end();

const pool = createPool(DATABASE_URL);
const db = createDb(pool);
const raw = drizzle(pool, { schema });

const email = `demo-${randomUUID().slice(0, 8)}@example.invalid`;
const storeId = randomUUID();
const customerId = randomUUID();
const staffId = randomUUID();

const money = (cents: number) => `€${(cents / 100).toFixed(2)}`;
const step = (n: number, title: string) => console.log(`\n${n}. ${title}`);
const ok = (msg: string) => console.log(`   -> ${msg}`);

async function main() {
  await applyMigrations(pool);
  await truncateAll(pool);

  console.log('BOKPOINTS demo — the real points engine against the real database\n');
  console.log('Store:    Kahvila Roastery   (1 point per euro, round down, 5.00 minimum)');
  console.log('Customer: Test Customer\n');

  await raw.insert(schema.staffUsers).values({
    id: staffId,
    email: `demo-staff-${randomUUID().slice(0, 8)}@example.invalid`,
    name: 'Demo Owner',
  });
  await raw.insert(schema.stores).values({ id: storeId, name: 'Kahvila Roastery' });
  await raw.insert(schema.customers).values({ id: customerId, email, name: 'Test Customer' });

  const rule = { pointsPerEuroThousandths: 1000, minPurchaseCents: 500 };

  step(1, 'Cashier scans the QR code and enters 23.80');
  const award = await recordEarn(db, {
    customerId,
    storeId,
    amountCents: 2380,
    rule,
    ruleVersion: 1,
    idempotencyKey: 'demo-award-1',
    staffId,
  });
  ok(`${award.points} points awarded`);
  ok(`balance is now ${await getBalance(db, customerId, storeId)}`);

  step(2, 'The response is lost and the cashier taps again (same idempotency key)');
  const retry = await recordEarn(db, {
    customerId,
    storeId,
    amountCents: 2380,
    rule,
    ruleVersion: 1,
    idempotencyKey: 'demo-award-1',
    staffId,
  });
  ok(`same entry returned (${retry.entryId === award.entryId ? 'yes' : 'no'}), no double award`);
  ok(`balance is still ${await getBalance(db, customerId, storeId)}`);

  step(3, 'A purchase under the store minimum (4.00 when the minimum is 5.00)');
  const small = await recordEarn(db, {
    customerId,
    storeId,
    amountCents: 400,
    rule,
    ruleVersion: 1,
    idempotencyKey: 'demo-award-2',
    staffId,
  });
  ok(`0 points awarded, reason: ${small.reason}`);
  ok('nothing was written to the ledger');

  step(4, 'The owner makes a manual adjustment of -5 points, with a reason');
  const adjust = await recordAdjust(db, {
    customerId,
    storeId,
    points: -5,
    reason: 'Cashier entered the wrong amount',
    staffId,
  });
  ok(`balance is now ${adjust.balance}`);

  step(5, 'The owner tries to remove 30 points');
  await recordAdjust(db, {
    customerId,
    storeId,
    points: -30,
    reason: 'Too many',
    staffId,
  }).catch((error: { code?: string; message: string }) => {
    ok(`refused: ${error.message}`);
  });
  ok(`balance is still ${await getBalance(db, customerId, storeId)}`);

  step(6, 'An admin applies a fraud clawback of 25 points');
  const clawback = await recordFraudClawback(db, {
    customerId,
    storeId,
    points: -25,
    caseNote: 'Case 2026-11: points awarded without a purchase',
    staffId,
  });
  ok(`balance is now ${clawback.balance} — the only way to go below zero`);
  const link = await pool.query(
    'select status from customer_store_links where customer_id = $1',
    [customerId],
  );
  ok(`customer-store link is now "${(link.rows[0] as { status: string }).status}"`);

  step(7, 'Expiry: 3 months after the day the points were earned');
  const earned = new Date('2026-06-02T10:30:00Z');
  ok(`earned ${earned.toISOString().slice(0, 10)} -> expires ${expiryDateForEarn(earned).toISOString().slice(0, 10)}`);
  const shortMonth = new Date('2026-01-31T12:00:00Z');
  ok(`earned ${shortMonth.toISOString().slice(0, 10)} -> expires ${expiryDateForEarn(shortMonth).toISOString().slice(0, 10)} (clamped to the last day of April)`);

  step(8, 'What the ledger actually contains');
  const ledger = await pool.query(
    `select type, points, amount_cents, reason from points_ledger_entries
     where customer_id = $1 order by created_at`,
    [customerId],
  );
  for (const row of ledger.rows as Array<{
    type: string;
    points: number;
    amount_cents: number | null;
    reason: string | null;
  }>) {
    const amount = row.amount_cents === null ? '' : `  ${money(row.amount_cents)}`;
    ok(
      `${row.type.padEnd(15)} ${String(row.points).padStart(4)} points${amount}${row.reason ? `  "${row.reason}"` : ''}`,
    );
  }
  ok(`balance ${await getBalance(db, customerId, storeId)} = the sum of those points`);

  console.log('\nThe ledger is append-only. Try to change one of those rows:');
  await pool
    .query('update points_ledger_entries set points = 999')
    .then(() => console.log('   -> the update succeeded (this should not be possible)'))
    .catch((error: { message: string }) => console.log(`   -> ${error.message}`));

  console.log('\nCleaning up the demo data...');
  await truncateAll(pool);
  console.log(`Done. The scratch database ${DEMO_DB} is empty again.\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

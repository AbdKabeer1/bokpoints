/**
 * One pass of the points expiry job (FR-PTS-10).
 *
 * Run with: pnpm expiry:run
 *
 * The script reads `apps/api/.env` for `DATABASE_URL` and runs the job
 * against that database once, then exits with a one-line summary. It is
 * safe to run at any time and never takes points that are not due: see
 * `src/db/expiry.ts`. Scheduling (running it daily) is a job of the host.
 */
import { createDb, createPool } from '../src/db/client.js';
import { runExpiry } from '../src/db/expiry.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. This script reads apps/api/.env (pnpm expiry:run).');
  process.exit(1);
}

const pool = createPool(databaseUrl);
const db = createDb(pool);

try {
  const result = await runExpiry(db);
  console.log(
    `Expiry run finished: ${result.expiredEntries} batches expired, ${result.pointsExpired} points removed.`,
  );
} finally {
  await pool.end();
}

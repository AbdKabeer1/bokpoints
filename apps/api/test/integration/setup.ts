import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations');

/**
 * Rebuilds the test database from the real migration files, so the tests
 * run against the same schema a deployment would have.
 */
export async function applyMigrations(pool: Pool): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      await pool.query(trimmed);
    }
  }
}

export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE points_ledger_entries, audit_log_entries, points_balances, customer_store_links, points_rules, credentials, cashier_devices, store_members, subscriptions, customers, stores, staff_users, rejected_offline_awards CASCADE',
  );
}

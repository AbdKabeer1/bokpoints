import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Rebuilds a database from the real migration files, so tests and the demo
 * run against the same schema a deployment would have.
 *
 * `DROP SCHEMA public CASCADE` is a superuser operation. It is only ever
 * used against a scratch database, never against a real one.
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

/**
 * Empties every table.
 *
 * TRUNCATE does not fire the row-level append-only triggers, so this bypasses
 * them. That is why it is only used to reset a scratch database. The
 * application itself has no path that truncates a ledger.
 */
export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE points_ledger_entries, audit_log_entries, points_balances, customer_store_links, points_rules, credentials, cashier_devices, store_members, subscriptions, customers, stores, staff_users, rejected_offline_awards CASCADE',
  );
}

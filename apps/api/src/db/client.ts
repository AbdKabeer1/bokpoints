import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

const isLocalHost = (connectionString: string): boolean =>
  /(^|@)(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(connectionString);

/**
 * Local Postgres speaks plain TCP. A hosted database (Supabase) requires TLS;
 * its pooler presents a certificate Node does not chain to a local CA, so the
 * connection is encrypted but not CA-verified. Credentials and queries are
 * still protected in transit — this is the same trade-off the Supabase
 * connection strings document with `sslmode=require`.
 */
export function poolConfig(connectionString: string): PoolConfig {
  if (isLocalHost(connectionString)) return { connectionString };
  const ca = process.env['DATABASE_CA_CERT'];
  if (ca) {
    return { connectionString, ssl: { ca, rejectUnauthorized: true } };
  }
  // No CA provided: encrypted but not verified. Acceptable for local dev only.
  return { connectionString, ssl: { rejectUnauthorized: false } };
}

export function createPool(connectionString: string): Pool {
  return new Pool(poolConfig(connectionString));
}

export function createDb(pool: Pool): Database {
  return drizzle(pool, { schema });
}

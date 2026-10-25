import { describe, expect, it } from 'vitest';
import { poolConfig } from '../../src/db/client.js';

describe('database connection config', () => {
  it('keeps local development on plain TCP', () => {
    expect(poolConfig('postgres://postgres:postgres@localhost:5432/bokpoints_dev')).toEqual({
      connectionString: 'postgres://postgres:postgres@localhost:5432/bokpoints_dev',
    });
    expect(
      poolConfig('postgres://postgres:postgres@127.0.0.1:5432/bokpoints_test').ssl,
    ).toBeUndefined();
  });

  it('uses TLS for a hosted pooler', () => {
    const config = poolConfig(
      'postgresql://postgres.abc:secret@aws-0-eu-north-1.pooler.supabase.com:5432/postgres',
    );
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
  });
});

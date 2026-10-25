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

  it('verifies TLS when DATABASE_CA_CERT is set', () => {
    const original = process.env.DATABASE_CA_CERT;
    process.env.DATABASE_CA_CERT = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----';
    const config = poolConfig(
      'postgresql://postgres.abc:secret@aws-0-eu-north-1.pooler.supabase.com:5432/postgres',
    );
    expect(config.ssl).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----',
      rejectUnauthorized: true,
    });
    if (original === undefined) delete process.env.DATABASE_CA_CERT;
    else process.env.DATABASE_CA_CERT = original;
  });
});

import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/env.js';

const base = { DATABASE_URL: 'postgres://localhost/bokpoints_test' };

describe('environment validation', () => {
  it('accepts a normal Supabase URL', () => {
    const env = loadEnv({ ...base, SUPABASE_URL: 'https://project.supabase.co' });
    expect(env.SUPABASE_URL).toBe('https://project.supabase.co');
  });

  it('repairs a URL that lost its leading h', () => {
    const env = loadEnv({ ...base, SUPABASE_URL: 'ttps://project.supabase.co' });
    expect(env.SUPABASE_URL).toBe('https://project.supabase.co');
  });

  it('still refuses a URL with no usable scheme', () => {
    expect(() => loadEnv({ ...base, SUPABASE_URL: 'project.supabase.co' })).toThrow(/http/);
  });

  it('accepts TRUST_PROXY false, true and numeric values', () => {
    expect(loadEnv({ ...base, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
    expect(loadEnv({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadEnv({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(loadEnv({ ...base, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
  });

  it('rejects invalid TRUST_PROXY values', () => {
    expect(() => loadEnv({ ...base, TRUST_PROXY: 'yes' })).toThrow();
    expect(() => loadEnv({ ...base, TRUST_PROXY: '0' })).toThrow();
    expect(() => loadEnv({ ...base, TRUST_PROXY: '-1' })).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/env.js';

const base = { DATABASE_URL: 'postgres://localhost/bokpoints_test' };

describe('environment validation', () => {
  it('accepts a normal Supabase URL', () => {
    const env = loadEnv({ ...base, SUPABASE_URL: 'https://project.supabase.co' });
    expect(env.SUPABASE_URL).toBe('https://project.supabase.co');
  });

  it('refuses a URL whose scheme is a typo', () => {
    expect(() => loadEnv({ ...base, SUPABASE_URL: 'ttps://project.supabase.co' })).toThrow(
      /http/,
    );
  });
});

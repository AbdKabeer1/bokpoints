import { describe, expect, it } from 'vitest';
import { createEmailVerifier } from '../../src/auth/supabase-admin.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const opts = (fetchImpl?: typeof fetch, secretKey = 'secret-key') => ({
  supabaseUrl: 'https://example.supabase.co/',
  secretKey,
  ...(fetchImpl === undefined ? {} : { fetchImpl }),
});

const jsonFetch = (ok: boolean, body: unknown) =>
  (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe('createEmailVerifier (Way Forward 4.2, D-120)', () => {
  it('is true when Supabase has confirmed the address', async () => {
    const fetchImpl = jsonFetch(true, { user: { email_confirmed_at: '2026-10-22T18:53:01Z' } });
    await expect(createEmailVerifier(opts(fetchImpl))(UUID)).resolves.toBe(true);
  });

  it('asks the Auth Admin API for exactly that user', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return { ok: true, json: async () => ({ email_confirmed_at: '2026-10-22T18:53:01Z' }) };
    }) as unknown as typeof fetch;
    await createEmailVerifier(opts(fetchImpl))(UUID);
    expect(seen).toEqual([`https://example.supabase.co/auth/v1/admin/users/${UUID}`]);
  });

  it('is false when the address is still unconfirmed', async () => {
    const fetchImpl = jsonFetch(true, { user: { email_confirmed_at: null } });
    await expect(createEmailVerifier(opts(fetchImpl))(UUID)).resolves.toBe(false);
  });

  it('fails closed when Supabase answers with an error', async () => {
    const fetchImpl = jsonFetch(false, { message: 'User not found' });
    await expect(createEmailVerifier(opts(fetchImpl))(UUID)).resolves.toBe(false);
  });

  it('fails closed when the network fails', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(createEmailVerifier(opts(fetchImpl))(UUID)).resolves.toBe(false);
  });

  it('fails closed when no secret key is configured', async () => {
    const fetchImpl = jsonFetch(true, { user: { email_confirmed_at: '2026-10-22T18:53:01Z' } });
    await expect(createEmailVerifier(opts(fetchImpl, ''))(UUID)).resolves.toBe(false);
  });
});

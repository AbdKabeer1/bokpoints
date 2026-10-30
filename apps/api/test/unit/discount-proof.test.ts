import { afterEach, describe, expect, it } from 'vitest';
import { checkDiscountProof, issueDiscountProof } from '../../src/db/discount-proof.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalDiscountSecret = process.env.DISCOUNT_PROOF_SECRET;
const originalSupabaseSecret = process.env.SUPABASE_SECRET_KEY;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalDiscountSecret === undefined) delete process.env.DISCOUNT_PROOF_SECRET;
  else process.env.DISCOUNT_PROOF_SECRET = originalDiscountSecret;
  if (originalSupabaseSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = originalSupabaseSecret;
});

describe('discount proof signing key', () => {
  it.each(['test', 'production'])('requires a dedicated secret in %s', (nodeEnv) => {
    process.env.NODE_ENV = nodeEnv;
    delete process.env.DISCOUNT_PROOF_SECRET;
    process.env.SUPABASE_SECRET_KEY = 'must-not-sign-discounts';

    expect(() => issueDiscountProof('customer-1', 'store-1')).toThrow(
      'DISCOUNT_PROOF_SECRET is required outside local development',
    );
  });

  it('signs and verifies with the dedicated secret', () => {
    process.env.NODE_ENV = 'test';
    process.env.DISCOUNT_PROOF_SECRET = 'dedicated-test-secret';
    process.env.SUPABASE_SECRET_KEY = 'unrelated-supabase-secret';
    const now = new Date('2026-10-30T10:00:00.000Z');

    const issued = issueDiscountProof('customer-1', 'store-1', now);

    expect(
      checkDiscountProof(
        issued.proof,
        { customerId: 'customer-1', storeId: 'store-1' },
        now,
      ),
    ).toMatchObject({ ok: true });
  });

  it('keeps a fixed fallback only for local development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.DISCOUNT_PROOF_SECRET;
    delete process.env.SUPABASE_SECRET_KEY;
    const now = new Date('2026-10-30T10:00:00.000Z');

    const issued = issueDiscountProof('customer-1', 'store-1', now);

    expect(checkDiscountProof(issued.proof, { storeId: 'store-1' }, now)).toMatchObject({
      ok: true,
    });
  });
});

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * The rotating discount proof (D-133): the customer's code is issued by the
 * API, signed with the server's key, valid for about a minute, and consumed
 * once. It exists so a discount can only be quoted from a fresh, online,
 * customer-present code — a screenshot of last week's QR is worthless.
 *
 * The signing key is the dedicated DISCOUNT_PROOF_SECRET. Until that value is
 * installed in Render it falls back to the Supabase secret key so a deploy
 * never takes the till down; the development fallback only runs outside
 * production. Nothing here is used offline: D-133 has no offline discounts.
 */
const PREFIX = 'POKDSC';
export const PROOF_TTL_MS = 60_000;

export interface ProofPayload {
  customerId: string;
  storeId: string;
  /** Issued-at, epoch milliseconds. */
  iat: number;
  /** The one-time identity of this code; the consumption table keys on it. */
  jti: string;
}

function signingKey(): Buffer {
  const secret =
    process.env['DISCOUNT_PROOF_SECRET'] ??
    process.env['SUPABASE_SECRET_KEY'] ??
    'dev-discount-proof-secret';
  return createHash('sha256').update(secret).digest();
}

function signBuffer(body: string): Buffer {
  return createHmac('sha256', signingKey()).update(body).digest();
}

export function issueDiscountProof(
  customerId: string,
  storeId: string,
  now: Date = new Date(),
): { proof: string; payload: ProofPayload } {
  const payload: ProofPayload = { customerId, storeId, iat: now.getTime(), jti: randomUUID() };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { proof: `${PREFIX}.${body}.${signBuffer(body).toString('base64url')}`, payload };
}

export type ProofCheck =
  | { ok: true; payload: ProofPayload }
  | { ok: false; reason: 'invalid' | 'expired' | 'customer_mismatch' | 'store_mismatch' };

/**
 * Checks a proof's signature, age and binding. `expected.customerId` and
 * `expected.storeId` are enforced when given — the confirm always gives
 * both, the till's dry-run gives the store (and the customer it serves).
 */
export function checkDiscountProof(
  proof: string,
  expected: { customerId?: string; storeId?: string },
  now: Date = new Date(),
): ProofCheck {
  const parts = proof.trim().split('.');
  const [prefix, body, signature] = parts;
  if (parts.length !== 3 || prefix !== PREFIX || body === undefined || signature === undefined) {
    return { ok: false, reason: 'invalid' };
  }

  const expectedSignature = signBuffer(body);
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'base64url');
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (given.length !== expectedSignature.length || !timingSafeEqual(given, expectedSignature)) {
    return { ok: false, reason: 'invalid' };
  }

  let payload: ProofPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as ProofPayload;
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (
    typeof payload?.iat !== 'number' ||
    typeof payload?.jti !== 'string' ||
    typeof payload?.customerId !== 'string' ||
    typeof payload?.storeId !== 'string'
  ) {
    return { ok: false, reason: 'invalid' };
  }

  const age = now.getTime() - payload.iat;
  if (age > PROOF_TTL_MS || age < -5_000) return { ok: false, reason: 'expired' };
  if (expected.customerId !== undefined && payload.customerId !== expected.customerId) {
    return { ok: false, reason: 'customer_mismatch' };
  }
  if (expected.storeId !== undefined && payload.storeId !== expected.storeId) {
    return { ok: false, reason: 'store_mismatch' };
  }
  return { ok: true, payload };
}

export function proofExpiresAt(payload: ProofPayload): Date {
  return new Date(payload.iat + PROOF_TTL_MS);
}

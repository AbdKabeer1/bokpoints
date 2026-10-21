import { z } from 'zod';

/**
 * Request and response schemas shared between the API and its clients
 * (AGENT.md section 10). The same schemas drive validation and the OpenAPI
 * document, so the two cannot drift apart.
 */

export const storeIdParamsSchema = z.object({
  storeId: z.string().uuid(),
});

export const customerParamsSchema = z.object({
  storeId: z.string().uuid(),
  customerId: z.string().uuid(),
});

/**
 * The largest purchase the API accepts, in cents.
 *
 * Two reasons for a cap. With no reversals (D-013) a mistyped amount is
 * permanent, so there is a sanity limit. And the points maths multiplies
 * the amount by the earn rate, so a huge amount would leave the range where
 * integers are exact.
 */
export const MAX_AMOUNT_CENTS = 100_000_000;

export const awardRequestSchema = z.object({
  customerId: z.string().uuid(),
  amountCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS),
});

export const credentialTypeSchema = z.enum(['app_qr', 'nfc_card', 'wallet_pass']);

export const identifyRequestSchema = z.object({
  credentialIdentifier: z.string().min(1).max(200),
  // The identifier is only unique per type, so the type has to travel with it.
  credentialType: credentialTypeSchema.default('app_qr'),
});

export const idempotencyKeyHeaderSchema = z.object({
  'idempotency-key': z.string().min(1).max(200),
});

export const awardResponseSchema = z.object({
  entryId: z.string().uuid().nullable(),
  points: z.number().int(),
  awarded: z.boolean(),
  reason: z.string().optional(),
});

export const identifyResponseSchema = z.object({
  customerId: z.string().uuid(),
  firstName: z.string(),
  balance: z.number().int(),
});

export const balanceResponseSchema = z.object({
  customerId: z.string().uuid(),
  storeId: z.string().uuid(),
  balance: z.number().int(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const healthResponseSchema = z.object({
  status: z.string(),
  version: z.string(),
});

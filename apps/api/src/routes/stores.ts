import { desc, eq } from 'drizzle-orm';
import {
  apiErrorSchema,
  awardRequestSchema,
  awardResponseSchema,
  balanceResponseSchema,
  customerParamsSchema,
  identifyRequestSchema,
  identifyResponseSchema,
  idempotencyKeyHeaderSchema,
  storeIdParamsSchema,
  type PointsRule,
} from '@bokpoints/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authorizeStoreRequest } from '../auth/authorize.js';
import type { SessionResolver } from '../auth/session.js';
import type { Database } from '../db/client.js';
import { getBalance, recordEarn } from '../db/ledger.js';
import { credentials, customers, pointsRules } from '../db/schema.js';

export interface RouteOptions {
  db: Database;
  sessionResolver?: SessionResolver | undefined;
}

const bearer = (header: string | undefined): string | undefined =>
  header?.replace(/^Bearer\s+/i, '').trim() || undefined;

/**
 * The three operations the Cashier screen needs, and that a future POS
 * integration will use through the same API (FR-API-1): identify a customer,
 * award points, get a balance.
 */
export const storeRoutes: FastifyPluginAsyncZod<RouteOptions> = async (app, options) => {
  const { db, sessionResolver } = options;

  /**
   * Resolve a credential to a customer. The cashier sees the first name and,
   * when online, the balance at this store (FR-STO-9).
   */
  app.post(
    '/v1/stores/:storeId/identify',
    {
      schema: {
        params: storeIdParamsSchema,
        body: identifyRequestSchema,
        response: {
          200: identifyResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { storeId } = request.params;
      const auth = await authorizeStoreRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        storeId,
        anyOf: ['customers.view_scanned', 'customers.list', 'customers.lookup'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const rows = await db
        .select({ customerId: credentials.customerId, name: customers.name })
        .from(credentials)
        .innerJoin(customers, eq(credentials.customerId, customers.id))
        .where(eq(credentials.identifier, request.body.credentialIdentifier))
        .limit(1);

      const found = rows[0];
      if (!found) {
        return reply
          .code(404)
          .send({ error: { code: 'CREDENTIAL_NOT_FOUND', message: 'That code is not recognised' } });
      }

      const balance = await getBalance(db, found.customerId, storeId);
      return reply.send({
        customerId: found.customerId,
        firstName: found.name.split(' ')[0] ?? found.name,
        balance,
      });
    },
  );

  /**
   * Award points for a purchase.
   *
   * The idempotency key is required, so a retry, a double tap or a resend
   * after an offline period never awards twice (FR-PTS-4, AC-2).
   */
  app.post(
    '/v1/stores/:storeId/awards',
    {
      schema: {
        params: storeIdParamsSchema,
        headers: idempotencyKeyHeaderSchema,
        body: awardRequestSchema,
        response: {
          200: awardResponseSchema,
          201: awardResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { storeId } = request.params;
      const auth = await authorizeStoreRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        storeId,
        anyOf: ['points.award'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const idempotencyKey = request.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
        return reply
          .code(400)
          .send({
            error: {
              code: 'IDEMPOTENCY_KEY_REQUIRED',
              message: 'Every award needs an Idempotency-Key header',
            },
          });
      }

      const rule = await currentRuleFor(db, storeId);
      if (!rule) {
        return reply
          .code(409)
          .send({
            error: { code: 'NO_ACTIVE_RULE', message: 'This store has no points rule yet' },
          });
      }

      const result = await recordEarn(db, {
        customerId: request.body.customerId,
        storeId,
        amountCents: request.body.amountCents,
        rule: rule.rule,
        ruleVersion: rule.ruleVersion,
        idempotencyKey,
        staffId: auth.staffUserId,
      });

      // 201 only when this request created an award. A replay of a request
      // that was already awarded, and a purchase that awards nothing, are
      // both a plain success: 200.
      const status = result.awarded && !result.replayed ? 201 : 200;
      return reply.code(status).send({
        entryId: result.entryId,
        points: result.points,
        awarded: result.awarded,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      });
    },
  );

  /** The customer's balance at this store. Never another store's balance. */
  app.get(
    '/v1/stores/:storeId/customers/:customerId/balance',
    {
      schema: {
        params: customerParamsSchema,
        response: {
          200: balanceResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { storeId, customerId } = request.params;
      const auth = await authorizeStoreRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        storeId,
        anyOf: ['customers.view_scanned', 'customers.list', 'customers.lookup'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const balance = await getBalance(db, customerId, storeId);
      return reply.send({ customerId, storeId, balance });
    },
  );
};

/**
 * The rule that applies to a purchase made now.
 *
 * FR-STO-5: a rule change applies to future purchases only, so the rule with
 * the highest version that is already active wins.
 */
async function currentRuleFor(
  db: Database,
  storeId: string,
): Promise<{ rule: PointsRule; ruleVersion: number } | null> {
  const rows = await db
    .select()
    .from(pointsRules)
    .where(eq(pointsRules.storeId, storeId))
    .orderBy(desc(pointsRules.ruleVersion))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const rule: PointsRule = {
    pointsPerEuroThousandths: row.pointsPerEuroThousandths,
    rounding: row.rounding === 'nearest' ? 'nearest' : 'floor',
    ...(row.minPurchaseCents === null ? {} : { minPurchaseCents: row.minPurchaseCents }),
    ...(row.maxPointsPerTransaction === null
      ? {}
      : { maxPointsPerTransaction: row.maxPointsPerTransaction }),
  };

  return { rule, ruleVersion: row.ruleVersion };
}

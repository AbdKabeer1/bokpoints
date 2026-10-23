import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  adjustmentRequestSchema,
  adjustmentResponseSchema,
  apiErrorSchema,
  storeCustomerHistoryResponseSchema,
  customerParamsSchema,
  registerCustomerRequestSchema,
  registeredCustomerSchema,
  storeCustomersQuerySchema,
  storeCustomersResponseSchema,
  storeIdParamsSchema,
} from '@bokpoints/shared';
import { authorizeStoreRequest } from '../auth/authorize.js';
import { getBalance, LedgerError, recordAdjust, type LedgerErrorCode } from '../db/ledger.js';
import { LEDGER_ERROR_STATUS } from './stores.js';
import type { Database } from '../db/client.js';
import {
  CustomerError,
  listStoreCustomers,
  registerStoreCustomer,
} from '../db/customers.js';
import { pointsLedgerEntries } from '../db/schema.js';
import { and, desc, eq } from 'drizzle-orm';
import type { SessionResolver } from '../auth/session.js';

export interface StoreCustomerRouteOptions {
  db: Database;
  sessionResolver?: SessionResolver | undefined;
  rateLimit?: { max: number; timeWindow: string } | undefined;
}

const bearer = (header: string | undefined): string | undefined =>
  header?.replace(/^Bearer\s+/i, '').trim() || undefined;

/**
 * The store's customers: registering someone who does not have the app yet
 * (FRD 4.4) and the customer list owners and managers work from.
 */
export const storeCustomerRoutes: FastifyPluginAsyncZod<StoreCustomerRouteOptions> = async (
  app,
  options,
) => {
  const { db, sessionResolver, rateLimit } = options;

  app.post(
    '/v1/stores/:storeId/customers',
    {
      config: { rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: storeIdParamsSchema,
        body: registerCustomerRequestSchema,
        response: {
          201: registeredCustomerSchema,
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
        anyOf: ['customers.register'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      try {
        const customer = await registerStoreCustomer(db, {
          storeId,
          email: request.body.email,
          ...(request.body.name === undefined ? {} : { name: request.body.name }),
        });

        return reply.code(201).send({
          customerId: customer.customerId,
          firstName: customer.name.split(' ')[0] ?? '',
          email: customer.email,
          balance: customer.balance,
          pending: customer.pending,
        });
      } catch (error) {
        if (error instanceof CustomerError) {
          return reply.code(409).send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    },
  );


  app.post(
    '/v1/stores/:storeId/customers/:customerId/adjustments',
    {
      config: { rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: customerParamsSchema,
        body: adjustmentRequestSchema,
        response: {
          200: adjustmentResponseSchema,
          201: adjustmentResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { storeId, customerId } = request.params;
      const auth = await authorizeStoreRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        storeId,
        anyOf: ['points.adjust'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      try {
        const result = await recordAdjust(db, {
          customerId,
          storeId,
          points: request.body.points,
          reason: request.body.reason,
          staffId: auth.staffUserId,
        });

        // 201 when points were added, 200 when they were taken away: both are
        // a completed adjustment, and the shape is the same.
        return reply.code(request.body.points > 0 ? 201 : 200).send(result);
      } catch (error) {
        if (error instanceof LedgerError) {
          return reply
            .code(LEDGER_ERROR_STATUS[error.code as LedgerErrorCode] ?? 400)
            .send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    },
  );

  app.get(
    '/v1/stores/:storeId/customers',
    {
      config: { rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' } },
      schema: {
        params: storeIdParamsSchema,
        querystring: storeCustomersQuerySchema,
        response: {
          200: storeCustomersResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { storeId } = request.params;
      const auth = await authorizeStoreRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        storeId,
        anyOf: ['customers.list'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const rows = await listStoreCustomers(db, storeId, request.query.query);

      return reply.send({
        customers: rows.map((row) => ({
          ...row,
          joinedAt: new Date(row.joinedAt).toISOString(),
        })),
      });
    },
  );

  /**
   * One customer's story at this store (the panel's customer detail):
   * their balance and their last hundred entries, newest first. Owners and
   * managers only — the till needs the balance, not the full history.
   */
  app.get(
    '/v1/stores/:storeId/customers/:customerId/history',
    {
      config: { rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' } },
      schema: {
        params: customerParamsSchema,
        response: {
          200: storeCustomerHistoryResponseSchema,
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
        anyOf: ['customers.list'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const balance = await getBalance(db, customerId, storeId);
      const rows = await db
        .select({
          id: pointsLedgerEntries.id,
          type: pointsLedgerEntries.type,
          points: pointsLedgerEntries.points,
          amountCents: pointsLedgerEntries.amountCents,
          reason: pointsLedgerEntries.reason,
          createdAt: pointsLedgerEntries.createdAt,
        })
        .from(pointsLedgerEntries)
        .where(
          and(
            eq(pointsLedgerEntries.customerId, customerId),
            eq(pointsLedgerEntries.storeId, storeId),
          ),
        )
        .orderBy(desc(pointsLedgerEntries.createdAt))
        .limit(100);

      return reply.send({
        balance,
        entries: rows.map((row) => ({
          id: row.id,
          type: row.type,
          points: row.points,
          amountCents: row.amountCents,
          reason: row.reason,
          createdAt: row.createdAt.toISOString(),
        })),
      });
    },
  );
};

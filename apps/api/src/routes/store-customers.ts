import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apiErrorSchema,
  registerCustomerRequestSchema,
  registeredCustomerSchema,
  storeCustomersQuerySchema,
  storeCustomersResponseSchema,
  storeIdParamsSchema,
} from '@bokpoints/shared';
import { authorizeStoreRequest } from '../auth/authorize.js';
import type { Database } from '../db/client.js';
import {
  CustomerError,
  listStoreCustomers,
  registerStoreCustomer,
} from '../db/customers.js';
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
};

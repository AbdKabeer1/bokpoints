import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apiErrorSchema,
  customerExpiringQuerySchema,
  customerExpiringResponseSchema,
  customerHistoryResponseSchema,
  customerMeResponseSchema,
  customerStoresResponseSchema,
  storeIdParamsSchema,
  updateCustomerRequestSchema,
} from '@bokpoints/shared';
import type { CustomerPrincipal, CustomerSessionResolver } from '../auth/session.js';
import type { Database } from '../db/client.js';
import {
  CustomerError,
  customerExpiring,
  customerStoreHistory,
  customerStores,
  provisionCustomer,
  updateCustomerProfile,
} from '../db/customers.js';
import type { CustomerProfile } from '../db/customers.js';

export interface CustomerRouteOptions {
  db: Database;
  customerResolver?: CustomerSessionResolver | undefined;
  rateLimit?: { max: number; timeWindow: string } | undefined;
}

const bearer = (header: string | undefined): string | undefined =>
  header?.replace(/^Bearer\s+/i, '').trim() || undefined;

const meBody = (customer: CustomerProfile, credentialIdentifier: string) => ({
  customer: {
    id: customer.id,
    email: customer.email,
    name: customer.name,
    language: customer.language,
    createdAt: customer.createdAt.toISOString(),
  },
  credential: { type: 'app_qr' as const, identifier: credentialIdentifier },
  onboardingComplete: customer.name.trim() !== '',
});

const customerErrorStatus = (code: string): 403 | 409 =>
  code === 'ACCOUNT_DELETED' ? 403 : 409;

/**
 * The customer's own data (FR-CUS-1, FR-CUS-2, FR-CUS-3, FR-CUS-5, FR-CUS-8).
 *
 * Nothing here takes a customer id: the identity comes from the bearer token
 * alone, so one customer can never ask for another's balances. The first call
 * provisions the customer row and their QR credential (D-111).
 */
export const customerRoutes: FastifyPluginAsyncZod<CustomerRouteOptions> = async (
  app,
  options,
) => {
  const { db, customerResolver, rateLimit } = options;

  const resolve = async (
    header: string | undefined,
  ): Promise<CustomerPrincipal | null> => {
    const token = bearer(header);
    if (token === undefined || customerResolver === undefined) return null;
    return customerResolver.resolve(token);
  };

  app.get(
    '/v1/customer/me',
    {
      config: { rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' } },
      schema: {
        response: {
          200: customerMeResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = await resolve(request.headers.authorization);
      if (principal === null) {
        return reply
          .code(401)
          .send({ error: { code: 'INVALID_TOKEN', message: 'That access token is not valid' } });
      }

      try {
        const customer = await provisionCustomer(db, principal);
        return reply.send(meBody(customer, customer.credentialIdentifier));
      } catch (error) {
        if (error instanceof CustomerError) {
          return reply
            .code(customerErrorStatus(error.code))
            .send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    },
  );

  app.patch(
    '/v1/customer/me',
    {
      config: { rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' } },
      schema: {
        body: updateCustomerRequestSchema,
        response: {
          200: customerMeResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = await resolve(request.headers.authorization);
      if (principal === null) {
        return reply
          .code(401)
          .send({ error: { code: 'INVALID_TOKEN', message: 'That access token is not valid' } });
      }

      try {
        const existing = await provisionCustomer(db, principal);
        const updated = await updateCustomerProfile(db, existing.id, request.body);
        return reply.send(meBody(updated, existing.credentialIdentifier));
      } catch (error) {
        if (error instanceof CustomerError) {
          return reply
            .code(customerErrorStatus(error.code))
            .send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    },
  );

  const provision = async (principal: CustomerPrincipal) => {
    try {
      return await provisionCustomer(db, principal);
    } catch (error) {
      if (error instanceof CustomerError) return error;
      throw error;
    }
  };

  app.get(
    '/v1/customer/me/stores',
    {
      config: { rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' } },
      schema: {
        response: {
          200: customerStoresResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = await resolve(request.headers.authorization);
      if (principal === null) {
        return reply
          .code(401)
          .send({ error: { code: 'INVALID_TOKEN', message: 'That access token is not valid' } });
      }

      const customer = await provision(principal);
      if (customer instanceof CustomerError) {
        return reply
          .code(customerErrorStatus(customer.code))
          .send({ error: { code: customer.code, message: customer.message } });
      }

      const rows = await customerStores(db, customer.id);
      return reply.send({
        stores: rows.map((row) => ({
          ...row,
          lastActivityAt: new Date(row.lastActivityAt).toISOString(),
        })),
      });
    },
  );

  app.get(
    '/v1/customer/me/stores/:storeId/history',
    {
      config: { rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' } },
      schema: {
        params: storeIdParamsSchema,
        response: {
          200: customerHistoryResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = await resolve(request.headers.authorization);
      if (principal === null) {
        return reply
          .code(401)
          .send({ error: { code: 'INVALID_TOKEN', message: 'That access token is not valid' } });
      }

      const customer = await provision(principal);
      if (customer instanceof CustomerError) {
        return reply
          .code(customerErrorStatus(customer.code))
          .send({ error: { code: customer.code, message: customer.message } });
      }

      const history = await customerStoreHistory(db, customer.id, request.params.storeId);
      if (history === null) {
        return reply.code(404).send({
          error: {
            code: 'STORE_NOT_FOUND',
            message: 'This customer has no history at that store',
          },
        });
      }

      return reply.send({
        storeName: history.storeName,
        balance: history.balance,
        entries: history.entries.map((entry) => ({
          ...entry,
          createdAt: new Date(entry.createdAt).toISOString(),
        })),
      });
    },
  );

  app.get(
    '/v1/customer/me/expiring',
    {
      config: { rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' } },
      schema: {
        querystring: customerExpiringQuerySchema,
        response: {
          200: customerExpiringResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = await resolve(request.headers.authorization);
      if (principal === null) {
        return reply
          .code(401)
          .send({ error: { code: 'INVALID_TOKEN', message: 'That access token is not valid' } });
      }

      const customer = await provision(principal);
      if (customer instanceof CustomerError) {
        return reply
          .code(customerErrorStatus(customer.code))
          .send({ error: { code: customer.code, message: customer.message } });
      }

      const items = await customerExpiring(db, customer.id, request.query.days);
      return reply.send({
        windowDays: request.query.days,
        items: items.map((item) => ({
          ...item,
          expiresAt: new Date(item.expiresAt).toISOString(),
        })),
      });
    },
  );
};

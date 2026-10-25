import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apiErrorSchema,
  customerExpiringQuerySchema,
  customerExpiringResponseSchema,
  customerHistoryResponseSchema,
  customerMeResponseSchema,
  customerNotificationParamsSchema,
  customerNotificationsResponseSchema,
  customerOffersResponseSchema,
  customerStoreRewardsResponseSchema,
  customerStoresResponseSchema,
  discountProofIssueResponseSchema,
  directoryResponseSchema,
  notificationReadResponseSchema,
  storeConsentRequestSchema,
  storeConsentResponseSchema,
  storeIdParamsSchema,
  updateCustomerRequestSchema,
} from '@bokpoints/shared';
import type { CustomerPrincipal, CustomerSessionResolver } from '../auth/session.js';
import type { Database } from '../db/client.js';
import { sql } from 'drizzle-orm';
import {
  CustomerError,
  customerExpiring,
  customerStoreHistory,
  customerStoreRewards,
  customerStores,
  provisionCustomer,
  updateCustomerProfile,
} from '../db/customers.js';
import {
  customerNotifications,
  markNotificationRead,
  setStoreConsent,
} from '../db/campaigns.js';
import type { CustomerProfile } from '../db/customers.js';
import { issueDiscountProof, proofExpiresAt } from '../db/discount-proof.js';
import { discountRules } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';

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
  code === 'EMAIL_ALREADY_LINKED' ? 409 : 403;

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
        const customer = await provisionCustomer(db, principal, customerResolver?.isEmailVerified);
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
        const existing = await provisionCustomer(db, principal, customerResolver?.isEmailVerified);
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
      return await provisionCustomer(db, principal, customerResolver?.isEmailVerified);
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

  /**
   * The store's rewards catalog, read-only (D-138): what the customer's
   * points are worth at this store. No balance and no limits — the till
   * decides those, where the spending happens.
   */
  app.get(
    '/v1/customer/stores/:storeId/rewards',
    {
      config: { rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' } },
      schema: {
        params: storeIdParamsSchema,
        response: {
          200: customerStoreRewardsResponseSchema,
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

      const rewards = await customerStoreRewards(db, request.params.storeId);
      return reply.send({ rewards });
    },
  );

  /**
   * Every active store on the platform, with the customer's own balance and
   * whether they have visited. This is the app's Stores tab, not a marketing
   * directory: it never exposes another customer's data.
   */
  app.get(
    '/v1/customer/stores',
    {
      config: { rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' } },
      schema: {
        response: {
          200: directoryResponseSchema,
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

      const rows = await db.execute(sql`
        SELECT
          s.id AS "storeId",
          s.name,
          s.address,
          s.brand_color AS "brandColor",
          s.logo_url AS "logoUrl",
          (link.id IS NOT NULL) AS "visited",
          coalesce(b.balance, 0)::int AS "balance"
        FROM stores s
        LEFT JOIN customer_store_links link
          ON link.store_id = s.id AND link.customer_id = ${customer.id}
        LEFT JOIN points_balances b
          ON b.store_id = s.id AND b.customer_id = ${customer.id}
        WHERE s.status = 'active'
        ORDER BY s.name
        LIMIT 200
      `);

      return reply.send({
        stores: (rows.rows as Record<string, unknown>[]).map((row) => ({
          storeId: String(row.storeId),
          name: String(row.name),
          address: row.address === null ? null : String(row.address),
          brandColor: row.brandColor === null ? null : String(row.brandColor),
          logoUrl: row.logoUrl === null ? null : String(row.logoUrl),
          visited: Boolean(row.visited),
          balance: Number(row.balance ?? 0),
        })),
      });
    },
  );

  /**
   * Active basket discounts at stores this customer has joined. These are the
   * store-funded offers the app shows under Offers; messages live elsewhere.
   */
  app.get(
    '/v1/customer/me/offers',
    {
      config: { rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' } },
      schema: {
        response: {
          200: customerOffersResponseSchema,
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

      const rows = await db.execute(sql`
        SELECT
          d.store_id AS "storeId",
          s.name AS "storeName",
          s.brand_color AS "brandColor",
          s.logo_url AS "logoUrl",
          d.threshold_cents AS "thresholdCents",
          d.kind,
          d.value
        FROM discount_rules d
        INNER JOIN stores s ON s.id = d.store_id
        INNER JOIN customer_store_links l
          ON l.store_id = d.store_id AND l.customer_id = ${customer.id}
        WHERE d.active = true AND s.status = 'active'
        ORDER BY s.name
      `);

      return reply.send({
        offers: rows.rows.map((row) => {
          const offer = row as Record<string, unknown>;
          return {
            storeId: String(offer.storeId),
            storeName: String(offer.storeName),
            brandColor: offer.brandColor === null ? null : String(offer.brandColor),
            logoUrl: offer.logoUrl === null ? null : String(offer.logoUrl),
            thresholdCents: Number(offer.thresholdCents ?? 0),
            kind: offer.kind === 'percent' ? ('percent' as const) : ('fixed_cents' as const),
            value: Number(offer.value ?? 0),
          };
        }),
      });
    },
  );

  /**
   * The customer's inbox: campaign messages from their stores, inside the
   * app (D-148). Only their own deliveries, never another customer's.
   */
  app.get(
    '/v1/customer/me/notifications',
    {
      config: { rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' } },
      schema: {
        response: {
          200: customerNotificationsResponseSchema,
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

      const inbox = await customerNotifications(db, customer.id);
      return reply.send({
        unread: inbox.unread,
        notifications: inbox.notifications.map((entry) => ({
          ...entry,
          createdAt: entry.createdAt.toISOString(),
          readAt: entry.readAt === null ? null : entry.readAt.toISOString(),
        })),
      });
    },
  );

  app.post(
    '/v1/customer/me/notifications/:notificationId/read',
    {
      config: { rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' } },
      schema: {
        params: customerNotificationParamsSchema,
        response: {
          200: notificationReadResponseSchema,
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

      const marked = await markNotificationRead(
        db,
        customer.id,
        request.params.notificationId,
      );
      if (marked === null) {
        return reply
          .code(404)
          .send({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'That message is not yours' } });
      }

      return reply.send({ id: marked.id, readAt: marked.readAt.toISOString() });
    },
  );

  /**
   * FR-PRV-2: store news is off until the customer says yes, per store.
   * A store the customer is not linked to answers 404.
   */
  app.patch(
    '/v1/customer/me/stores/:storeId/consent',
    {
      config: { rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: storeIdParamsSchema,
        body: storeConsentRequestSchema,
        response: {
          200: storeConsentResponseSchema,
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

      const saved = await setStoreConsent(
        db,
        customer.id,
        request.params.storeId,
        request.body.marketingConsent,
      );
      if (!saved) {
        return reply.code(404).send({
          error: { code: 'STORE_NOT_FOUND', message: 'You have no history at that store' },
        });
      }

      return reply.send({
        storeId: request.params.storeId,
        marketingConsent: request.body.marketingConsent,
      });
    },
  );

  /**
   * A fresh rotating discount code (D-133), bound to this customer and
   * this store. Issued only online — there are no offline discounts — and
   * good for about a minute, once. `active` says whether the store has a
   * discount running, so the app can hide the code when there is none.
   */
  app.post(
    '/v1/customer/stores/:storeId/discount-proof',
    {
      config: { rateLimit: rateLimit ?? { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: storeIdParamsSchema,
        response: {
          200: discountProofIssueResponseSchema,
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

      const rule = await db
        .select({ id: discountRules.id })
        .from(discountRules)
        .where(
          and(
            eq(discountRules.storeId, request.params.storeId),
            eq(discountRules.active, true),
          ),
        )
        .limit(1);

      const issued = issueDiscountProof(customer.id, request.params.storeId);
      return reply.send({
        proof: issued.proof,
        expiresAt: proofExpiresAt(issued.payload).toISOString(),
        active: rule.length > 0,
      });
    },
  );
};

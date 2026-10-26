import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apiErrorSchema,
  customerExpiringQuerySchema,
  customerExpiringResponseSchema,
  customerExportSchema,
  deleteCustomerRequestSchema,
  feedbackRequestSchema,
  feedbackResponseSchema,
  deleteCustomerResponseSchema,
  customerHistoryResponseSchema,
  customerMeResponseSchema,
  customerNotificationParamsSchema,
  customerNotificationsResponseSchema,
  customerOffersResponseSchema,
  customerStoreRewardsResponseSchema,
  customerStoresResponseSchema,
  discountProofIssueResponseSchema,
  directoryQuerySchema,
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
  anonymiseCustomer,
  clearCustomerAuthUserId,
  customerExpiring,
  customerStoreHistory,
  customerStoreRewards,
  customerStores,
  exportCustomerData,
  provisionCustomer,
  updateCustomerProfile,
} from '../db/customers.js';
import {
  customerNotifications,
  markNotificationRead,
  setStoreConsent,
} from '../db/campaigns.js';
import type { CustomerProfile } from '../db/customers.js';
import type { AuthUserDeleter, EmailOtpVerifier } from '../auth/supabase-admin.js';
import { recordFeedback } from '../db/feedback.js';
import { issueDiscountProof, proofExpiresAt } from '../db/discount-proof.js';
import { discountRules } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';

export interface CustomerRouteOptions {
  db: Database;
  customerResolver?: CustomerSessionResolver | undefined;
  rateLimit?: { max: number; timeWindow: string } | undefined;
  /** Verifies a fresh email one-time code before deletion (A5). */
  otpVerifier?: EmailOtpVerifier | undefined;
  /** Deletes the Supabase Auth user after the ledger-safe anonymisation. */
  deleteAuthUser?: AuthUserDeleter | undefined;
}

const bearer = (header: string | undefined): string | undefined =>
  header?.replace(/^Bearer\s+/i, '').trim() || undefined;

const meBody = (customer: CustomerProfile, credentialIdentifier: string) => ({
  customer: {
    id: customer.id,
    email: customer.email,
    name: customer.name,
    language: customer.language,
    notificationsEnabled: customer.notificationsEnabled,
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
        querystring: directoryQuerySchema,
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

      const query = request.query as { lat?: number; lon?: number };
      const hasLocation = typeof query.lat === 'number' && typeof query.lon === 'number';

      const rows = await db.execute(sql`
        SELECT
          s.id AS "storeId",
          s.name,
          s.address,
          s.category,
          s.brand_color AS "brandColor",
          s.logo_url AS "logoUrl",
          s.latitude,
          s.longitude,
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

      const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371;
        const toRad = (d: number) => (d * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };

      const storesOut = (rows.rows as Array<Record<string, unknown>>)
        .map((row) => {
          const lat = row.latitude != null ? Number(row.latitude) : null;
          const lon = row.longitude != null ? Number(row.longitude) : null;
          let distanceKm: number | null = null;
          if (hasLocation && lat != null && lon != null) {
            distanceKm = Number(haversine(query.lat!, query.lon!, lat, lon).toFixed(1));
          }
          return {
            storeId: String(row.storeId),
            name: String(row.name),
            address: row.address === null ? null : String(row.address),
            category: row.category === null || row.category === undefined ? null : String(row.category),
            brandColor: row.brandColor === null ? null : String(row.brandColor),
            logoUrl: row.logoUrl === null ? null : String(row.logoUrl),
            visited: Boolean(row.visited),
            balance: Number(row.balance ?? 0),
            distanceKm,
          };
        })
        .sort((a, b) => {
          if (hasLocation) {
            if (a.distanceKm == null && b.distanceKm == null) return a.name.localeCompare(b.name);
            if (a.distanceKm == null) return 1;
            if (b.distanceKm == null) return -1;
            if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
          }
          return 0;
        });

      return reply.send({ stores: storesOut });
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
  /**
   * A5: the customer's own data as JSON. Rate-limited to a few requests an
   * hour because it reads their whole ledger.
   */
  app.get(
    '/v1/customer/me/export',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: {
        response: {
          200: customerExportSchema,
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

      const data = await exportCustomerData(db, customer.id);
      if (data === null) {
        return reply
          .code(404)
          .send({ error: { code: 'CUSTOMER_NOT_FOUND', message: 'No such customer' } });
      }
      return reply.send(data);
    },
  );

  /**
   * A5: anonymise the customer and keep the ledger. A fresh one-time code is
   * required because deletion cannot be undone. If Supabase Auth deletion
   * fails, auth_user_id stays on the deleted row so the old token is refused,
   * and the request can be retried.
   */
  app.post(
    '/v1/customer/me/delete',
    {
      config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
      schema: {
        body: deleteCustomerRequestSchema,
        response: {
          200: deleteCustomerResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
          503: apiErrorSchema,
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
        if (customer.code === 'ACCOUNT_DELETED') return reply.send({ deleted: true as const });
        return reply
          .code(customerErrorStatus(customer.code))
          .send({ error: { code: customer.code, message: customer.message } });
      }

      if (options.otpVerifier === undefined) {
        return reply.code(503).send({
          error: {
            code: 'OTP_UNAVAILABLE',
            message: 'A fresh sign-in code cannot be checked right now',
          },
        });
      }

      const valid = await options.otpVerifier(customer.email, request.body.code);
      if (!valid) {
        return reply.code(403).send({
          error: { code: 'CODE_INVALID', message: 'That code is not valid or has expired' },
        });
      }

      const result = await anonymiseCustomer(db, customer.id, { actorRole: 'customer' });
      if (result === null) {
        return reply
          .code(404)
          .send({ error: { code: 'CUSTOMER_NOT_FOUND', message: 'No such customer' } });
      }

      if (result.authUserId !== null && options.deleteAuthUser !== undefined) {
        try {
          await options.deleteAuthUser(result.authUserId);
          await clearCustomerAuthUserId(db, result.customerId);
        } catch {
          // Keep the link: the old token then resolves to a deleted row and
          // is refused. An admin can retry the Auth deletion later.
          request.log.warn({ customerId: result.customerId }, 'Auth user deletion failed');
        }
      }

      return reply.send({ deleted: true as const });
    },
  );

  /** In-app feedback from the customer app; stored for the admin Support view. */
  app.post(
    '/v1/customer/me/feedback',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: {
        body: feedbackRequestSchema,
        response: {
          201: feedbackResponseSchema,
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

      const customer = await provision(principal);
      if (customer instanceof CustomerError) {
        return reply
          .code(customerErrorStatus(customer.code))
          .send({ error: { code: customer.code, message: customer.message } });
      }

      const saved = await recordFeedback(db, {
        source: 'customer',
        category: request.body.category,
        message: request.body.message,
        page: request.body.page ?? null,
        contactEmail: customer.email,
        customerId: customer.id,
      });

      return reply.code(201).send({
        id: saved.id,
        createdAt: saved.createdAt.toISOString(),
      });
    },
  );


};

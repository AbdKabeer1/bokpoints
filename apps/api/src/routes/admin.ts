import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  adjustmentResponseSchema,
  adminAnalyticsResponseSchema,
  adminAnonymiseCustomerRequestSchema,
  adminAnonymiseCustomerResponseSchema,
  adminCustomerParamsSchema,
  adminFeedbackResponseSchema,
  adminSafetySignalsResponseSchema,
  adminStoreDetailSchema,
  feedbackRequestSchema,
  feedbackResponseSchema,
  adminStoreStatusRequestSchema,
  adminStoreStatusResponseSchema,
  adminStoresQuerySchema,
  adminStoresResponseSchema,
  adminSubscriptionsResponseSchema,
  adminSupportQuerySchema,
  adminSupportResponseSchema,
  apiErrorSchema,
  businessLeadSchema,
  leadsResponseSchema,
  clawbackRequestSchema,
  createdStoreResponseSchema,
  createStoreRequestSchema,
  customerParamsSchema,
  storeIdParamsSchema,
} from '@bokpoints/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { authorizeAdminRequest, hasRecentMfa } from '../auth/authorize.js';
import {
  auditLogEntries,
  businessLeads,
  customers,
  earningRules,
  pointsBalances,
  pointsRules,
  staffUsers,
  storeLocations,
  storeMembers,
  stores,
  subscriptions,
} from '../db/schema.js';
import { LedgerError, recordFraudClawback, type LedgerErrorCode } from '../db/ledger.js';
import { anonymiseCustomer, clearCustomerAuthUserId } from '../db/customers.js';
import { listFeedback, recordFeedback } from '../db/feedback.js';
import { createStaffAccountForInvite, StaffAccountError } from '../db/staff.js';
import { LEDGER_ERROR_STATUS } from './stores.js';
import type { RouteOptions } from './stores.js';

const bearer = (header: string | undefined): string | undefined =>
  header?.replace(/^Bearer\s+/i, '').trim() || undefined;

const allowDevAuth = process.env.ALLOW_DEV_AUTH === 'true';

/**
 * Development-only endpoint: ensures the admin staff user exists and returns
 * a token usable with the dev session resolver (the email itself).
 * Only works when ALLOW_DEV_AUTH=true (never in production).
 */
async function devAdminToken(app: FastifyInstance, db: Database) {
  if (!allowDevAuth) return;

  const { upsertStaffAccount } = await import('../db/staff.js');

  app.post(
    '/v1/admin/dev-token',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { email } = request.body as { email?: string };
      if (!email) {
        return reply.code(400).send({ error: { code: 'MISSING_EMAIL', message: 'Email required' } });
      }

      const staffId = await upsertStaffAccount(db, {
        email: email.toLowerCase(),
        name: 'Dev Admin',
        authUserId: randomUUID(),
        isAdmin: true,
      });

      return reply.send({
        token: email.toLowerCase(),
        note: 'Use this email as the Bearer token with ALLOW_DEV_AUTH=true',
        staffId,
      });
    },
  );
}

import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/client.js';
import { randomUUID } from 'node:crypto';

/**
 * Platform operations, all admin-only (FRD section 2): creating stores with
 * their first points rule, branches and first owner.
 */
export const adminRoutes: FastifyPluginAsyncZod<RouteOptions> = async (app, options) => {
  const { db, sessionResolver, rateLimit } = options;

  // Development-only admin token endpoint
  await devAdminToken(app, db);

  /**
   * Creates a store and everything it needs to start awarding: the store
   * row (active, FRD 4.1), points rule version 1 (FR-STO-5), its optional
   * branches (D-103) and its first owner.
   *
   * The first owner has to be named here: no owner exists yet who could
   * invite them, and the store would otherwise be unreachable without
   * writing to the database by hand.
   */
  app.post(
    '/v1/admin/stores',
    {
      config: {
        rateLimit: rateLimit ?? { max: 30, timeWindow: '1 minute' },
      },
      schema: {
        body: createStoreRequestSchema,
        response: {
          201: createdStoreResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeAdminRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        anyOf: ['store.create'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const body = request.body;

      const runCreate = () => db.transaction(async (tx) => {
        const insertedStore = await tx
          .insert(stores)
          .values({
            name: body.name,
            ...(body.address === undefined ? {} : { address: body.address }),
            ...(body.contactName === undefined ? {} : { contactName: body.contactName }),
            ...(body.contactEmail === undefined ? {} : { contactEmail: body.contactEmail }),
            status: 'active',
            maxPointsPerSale: body.pointsRule.maxPointsPerTransaction ?? null,
          })
          .returning({ id: stores.id });
        const storeId = insertedStore[0]?.id;
        if (!storeId) throw new Error('Could not create the store');

        // The legacy per-euro row stays (existing ledger entries point at it);
        // the earning rule below is what awards read from WP2 onward (D-116).
        await tx.insert(pointsRules).values({
          storeId,
          ruleVersion: 1,
          pointsPerEuroThousandths: body.pointsRule.pointsPerEuroThousandths,
          rounding: body.pointsRule.rounding,
          minPurchaseCents: body.pointsRule.minPurchaseCents ?? null,
          maxPointsPerTransaction: body.pointsRule.maxPointsPerTransaction ?? null,
          activeFrom: new Date(),
        });

        await tx.insert(earningRules).values({
          storeId,
          type: 'per_euro',
          params: {
            pointsPerEuroThousandths: body.pointsRule.pointsPerEuroThousandths,
            rounding: body.pointsRule.rounding,
          },
          conditions:
            body.pointsRule.minPurchaseCents === undefined
              ? {}
              : { minSpendCents: body.pointsRule.minPurchaseCents },
          effectiveFrom: new Date(),
          status: 'active',
          version: 1,
          createdBy: auth.staffUserId,
        });

        const branches: { id: string; name: string }[] = [];
        for (const branch of body.branches ?? []) {
          const inserted = await tx
            .insert(storeLocations)
            .values({
              storeId,
              name: branch.name,
              ...(branch.address === undefined ? {} : { address: branch.address }),
            })
            .returning({ id: storeLocations.id, name: storeLocations.name });
          const row = inserted[0];
          if (!row) throw new Error('Could not create the branch');
          branches.push(row);
        }

        // D-119: an owner email that already exists is reused untouched —
        // creating a store can never alter an existing account (4.1).
        const { userId: ownerId } = await createStaffAccountForInvite(tx, {
          email: body.owner.email,
          name: body.owner.name,
          authUserId: body.owner.authUserId,
          isAdmin: false,
        });
        const insertedMember = await tx
          .insert(storeMembers)
          .values({ storeId, userId: ownerId, role: 'owner' })
          .returning({ id: storeMembers.id });
        const memberId = insertedMember[0]?.id;
        if (!memberId) throw new Error('Could not create the owner membership');

        await tx.insert(auditLogEntries).values({
          actorId: auth.staffUserId,
          actorRole: 'admin',
          action: 'store.create',
          storeId,
          targetType: 'store',
          targetId: storeId,
          after: { name: body.name, ruleVersion: 1, branches: branches.length },
        });

        return { storeId, branches, memberId };
      });

      let created: Awaited<ReturnType<typeof runCreate>>;
      try {
        created = await runCreate();
      } catch (error) {
        if (error instanceof StaffAccountError) {
          return reply.code(409).send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }

      return reply.code(201).send({
        storeId: created.storeId,
        name: body.name,
        status: 'active',
        rule: {
          ruleVersion: 1,
          pointsPerEuroThousandths: body.pointsRule.pointsPerEuroThousandths,
          rounding: body.pointsRule.rounding,
          ...(body.pointsRule.minPurchaseCents === undefined
            ? {}
            : { minPurchaseCents: body.pointsRule.minPurchaseCents }),
          ...(body.pointsRule.maxPointsPerTransaction === undefined
            ? {}
            : { maxPointsPerTransaction: body.pointsRule.maxPointsPerTransaction }),
        },
        branches: created.branches.map((branch) => ({ id: branch.id, name: branch.name })),
        owner: { id: created.memberId, email: body.owner.email, locationId: null },
      });
    },
  );

  /**
   * The only action that may take a balance below zero (FRD 4.6, AC-11).
   * Admin only; the case note is required and lands in the audit log.
   */
  app.post(
    '/v1/admin/stores/:storeId/customers/:customerId/clawback',
    {
      config: { rateLimit: rateLimit ?? { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: customerParamsSchema,
        body: clawbackRequestSchema,
        response: {
          200: adjustmentResponseSchema,
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
      const auth = await authorizeAdminRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        anyOf: ['points.fraud_clawback'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      try {
        const result = await recordFraudClawback(db, {
          customerId,
          storeId,
          points: -request.body.points,
          caseNote: request.body.caseNote,
          staffId: auth.staffUserId,
        });
        return reply.send(result);
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

  /**
   * The platform's store list (brief §4.3): every store with the numbers an
   * operator needs to triage it. One query, no per-row calls.
   */
  app.get(
    '/v1/admin/stores',
    {
      config: { rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' } },
      schema: {
        querystring: adminStoresQuerySchema,
        response: {
          200: adminStoresResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeAdminRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        anyOf: ['store.manage'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const status = request.query.status ?? null;
      const query = request.query.query ?? null;

      const result = await db.execute(sql`
        SELECT
          s.id AS "storeId",
          s.name,
          s.status,
          s.plan,
          (SELECT count(*)::int FROM customer_store_links l WHERE l.store_id = s.id) AS customers,
          (SELECT max(e.created_at) FROM points_ledger_entries e WHERE e.store_id = s.id) AS last_activity_at,
          s.created_at
        FROM stores s
        WHERE (${status}::text IS NULL OR s.status = ${status}::text)
          AND (${query}::text IS NULL OR s.name ILIKE '%' || ${query}::text || '%')
        ORDER BY s.created_at DESC
        LIMIT 200
      `);

      return reply.send({
        stores: (result.rows as Record<string, unknown>[]).map((row) => ({
          storeId: String(row.storeId),
          name: String(row.name),
          status: String(row.status),
          plan: row.plan === null ? null : String(row.plan),
          customers: Number(row.customers ?? 0),
          lastActivityAt:
            row.last_activity_at === null || row.last_activity_at === undefined
              ? null
              : new Date(row.last_activity_at as string).toISOString(),
          createdAt: new Date(row.created_at as string).toISOString(),
        })),
      });
    },
  );

  /**
   * All business leads across every store. An admin can see every invite that
   * any owner has sent, with the store name and the invited business details.
   */
  app.get(
    '/v1/admin/leads',
    {
      config: { rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' } },
      schema: {
        querystring: adminStoresQuerySchema,
        response: {
          200: leadsResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeAdminRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        anyOf: ['store.manage'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const query = request.query;
      const whereClause = query.query
        ? sql`WHERE bl.name ILIKE '%' || ${query.query} || '%' OR bl.category ILIKE '%' || ${query.query} || '%' OR s.name ILIKE '%' || ${query.query} || '%'`
        : sql``;

      const rows = await db.execute(sql`
        SELECT
          bl.id AS lead_id,
          bl.store_id,
          bl.osm_id,
          bl.name,
          bl.category,
          bl.address,
          bl.website,
          bl.phone,
          bl.opening_hours,
          bl.latitude,
          bl.longitude,
          bl.distance_km,
          bl.status,
          bl.created_at,
          s.name AS store_name,
          s.brand_color
        FROM business_leads bl
        INNER JOIN stores s ON s.id = bl.store_id
        ${whereClause}
        ORDER BY bl.created_at DESC
        LIMIT 500
      `);

      const leads = (rows.rows as Record<string, unknown>[]).map((row) => ({
        leadId: String(row.lead_id),
        storeId: String(row.store_id),
        storeName: String(row.store_name),
        storeBrandColor: row.brand_color === null ? null : String(row.brand_color),
        osmId: String(row.osm_id),
        name: String(row.name),
        category: row.category === null ? null : String(row.category),
        address: row.address === null ? null : String(row.address),
        website: row.website === null ? null : String(row.website),
        phone: row.phone === null ? null : String(row.phone),
        openingHours: row.opening_hours === null ? null : String(row.opening_hours),
        latitude: row.latitude === null ? null : Number(row.latitude),
        longitude: row.longitude === null ? null : Number(row.longitude),
        distanceKm: row.distance_km === null ? null : Number(row.distance_km),
        status: String(row.status),
        createdAt: new Date(row.created_at as string).toISOString(),
      }));

      return reply.send({ leads });
    },
  );

  /**
   * One store, seen from the platform: identity, subscription, the numbers
   * that show whether it is working, its readiness checklist, its people and
   * its latest audited actions.
   */
  app.get(
    '/v1/admin/stores/:storeId',
    {
      config: { rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: storeIdParamsSchema,
        response: {
          200: adminStoreDetailSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeAdminRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        anyOf: ['store.manage'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const { storeId } = request.params;
      const found = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
      const store = found[0];
      if (store === undefined) {
        return reply
          .code(404)
          .send({ error: { code: 'STORE_NOT_FOUND', message: 'No such store' } });
      }

      const countsResult = await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM customer_store_links WHERE store_id = ${storeId}) AS customers,
          (SELECT count(*)::int FROM store_members WHERE store_id = ${storeId}) AS staff,
          (SELECT count(*)::int FROM earning_rules WHERE store_id = ${storeId} AND status = 'active') AS active_rules,
          (SELECT count(*)::int FROM store_rewards WHERE store_id = ${storeId} AND active = true) AS active_rewards,
          (SELECT count(*)::int FROM store_locations WHERE store_id = ${storeId}) AS branches,
          (SELECT count(*)::int FROM points_ledger_entries
             WHERE store_id = ${storeId} AND type = 'earn'
               AND created_at > now() - interval '30 days') AS awards_30d,
          (SELECT count(*)::int FROM points_ledger_entries
             WHERE store_id = ${storeId} AND type = 'redeem'
               AND created_at > now() - interval '30 days') AS redemptions_30d,
          (SELECT coalesce(sum(balance), 0)::int FROM points_balances WHERE store_id = ${storeId}) AS outstanding_points,
          (SELECT count(*)::int FROM store_members WHERE store_id = ${storeId} AND role = 'owner' AND status = 'active') AS owners,
          (SELECT count(*)::int FROM store_members WHERE store_id = ${storeId} AND role = 'cashier' AND status = 'active') AS cashiers
      `);
      const counts = (countsResult.rows[0] ?? {}) as Record<string, number | null>;

      const staffRows = await db
        .select({
          memberId: storeMembers.id,
          name: staffUsers.name,
          email: staffUsers.email,
          role: storeMembers.role,
          status: storeMembers.status,
          locationName: storeLocations.name,
        })
        .from(storeMembers)
        .innerJoin(staffUsers, eq(staffUsers.id, storeMembers.userId))
        .leftJoin(storeLocations, eq(storeLocations.id, storeMembers.locationId))
        .where(eq(storeMembers.storeId, storeId))
        .orderBy(storeMembers.role, staffUsers.name);

      const recentRows = await db
        .select({
          id: auditLogEntries.id,
          action: auditLogEntries.action,
          actorEmail: staffUsers.email,
          targetType: auditLogEntries.targetType,
          targetId: auditLogEntries.targetId,
          reason: auditLogEntries.reason,
          createdAt: auditLogEntries.createdAt,
          before: auditLogEntries.before,
          after: auditLogEntries.after,
        })
        .from(auditLogEntries)
        .leftJoin(staffUsers, eq(staffUsers.id, auditLogEntries.actorId))
        .where(eq(auditLogEntries.storeId, storeId))
        .orderBy(desc(auditLogEntries.createdAt), desc(auditLogEntries.id))
        .limit(10);

      const subscriptionRows = await db
        .select({
          plan: subscriptions.plan,
          status: subscriptions.status,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
        })
        .from(subscriptions)
        .where(eq(subscriptions.storeId, storeId))
        .limit(1);
      const subscription = subscriptionRows[0] ?? null;

      return reply.send({
        store: {
          storeId: store.id,
          name: store.name,
          status: store.status,
          plan: store.plan,
          address: store.address,
          contactName: store.contactName,
          contactEmail: store.contactEmail,
          brandColor: store.brandColor,
          logoUrl: store.logoUrl,
          maxPointsPerSale: store.maxPointsPerSale,
          createdAt: store.createdAt.toISOString(),
        },
        subscription:
          subscription === null
            ? null
            : {
                plan: subscription.plan,
                status: subscription.status,
                currentPeriodEnd:
                  subscription.currentPeriodEnd === null
                    ? null
                    : subscription.currentPeriodEnd.toISOString(),
              },
        counts: {
          customers: Number(counts.customers ?? 0),
          staff: Number(counts.staff ?? 0),
          activeRules: Number(counts.active_rules ?? 0),
          activeRewards: Number(counts.active_rewards ?? 0),
          branches: Number(counts.branches ?? 0),
          awards30d: Number(counts.awards_30d ?? 0),
          redemptions30d: Number(counts.redemptions_30d ?? 0),
          outstandingPoints: Number(counts.outstanding_points ?? 0),
        },
        readiness: {
          owner: Number(counts.owners ?? 0) > 0,
          rule: Number(counts.active_rules ?? 0) > 0,
          reward: Number(counts.active_rewards ?? 0) > 0,
          cashier: Number(counts.cashiers ?? 0) > 0,
        },
        staff: staffRows,
        recent: recentRows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })),
      });
    },
  );

  /**
   * Suspend or reactivate a store (FRD 4.1). Every change carries a reason
   * and lands in the audit log; a suspended store's till refuses to trade.
   */
  app.post(
    '/v1/admin/stores/:storeId/status',
    {
      config: { rateLimit: rateLimit ?? { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: storeIdParamsSchema,
        body: adminStoreStatusRequestSchema,
        response: {
          200: adminStoreStatusResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeAdminRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        anyOf: ['store.status'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }
      if (!hasRecentMfa(auth.mfaAt)) {
        return reply.code(403).send({
          error: {
            code: 'MFA_STEP_UP_REQUIRED',
            message: 'Sign in again with your authenticator before changing a store status',
          },
        });
      }

      const { storeId } = request.params;
      const found = await db
        .select({ status: stores.status, name: stores.name })
        .from(stores)
        .where(eq(stores.id, storeId))
        .limit(1);
      const existing = found[0];
      if (existing === undefined) {
        return reply
          .code(404)
          .send({ error: { code: 'STORE_NOT_FOUND', message: 'No such store' } });
      }

      await db.transaction(async (tx) => {
        await tx
          .update(stores)
          .set({ status: request.body.status, updatedAt: new Date() })
          .where(eq(stores.id, storeId));
        await tx.insert(auditLogEntries).values({
          actorId: auth.staffUserId,
          actorRole: 'admin',
          action: 'store.status',
          storeId,
          targetType: 'store',
          targetId: storeId,
          reason: request.body.reason,
          before: { status: existing.status },
          after: { status: request.body.status },
        });
      });

      return reply.send({ storeId, status: request.body.status });
    },
  );


  /**
   * A5: anonymise a customer from the platform console. The ledger stays;
   * the identity, credentials, consents and campaign copies go.
   */
  app.post(
    '/v1/admin/customers/:customerId/anonymise',
    {
      config: { rateLimit: rateLimit ?? { max: 5, timeWindow: '1 hour' } },
      schema: {
        params: adminCustomerParamsSchema,
        body: adminAnonymiseCustomerRequestSchema,
        response: {
          200: adminAnonymiseCustomerResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeAdminRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        anyOf: ['customer.anonymise'],
      });
      if (!auth.ok) return reply.code(auth.status).send({ error: auth.error });
      if (!hasRecentMfa(auth.mfaAt)) {
        return reply.code(403).send({
          error: {
            code: 'MFA_STEP_UP_REQUIRED',
            message: 'Sign in again with your authenticator before anonymising a customer',
          },
        });
      }

      const result = await anonymiseCustomer(db, request.params.customerId, {
        actorId: auth.staffUserId,
        actorRole: 'admin',
        reason: request.body.reason,
      });
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
          request.log.warn({ customerId: result.customerId }, 'Auth user deletion failed');
        }
      }

      return reply.send({ customerId: result.customerId, deleted: true as const });
    },
  );


  /**
   * C8: the first simple fraud view. Counts the things a pilot store can
   * actually see — heavy awarding, repeat redemptions, reversals and manual
   * adjustments — and returns only the rows over the agreed thresholds.
   */
  app.get(
    '/v1/admin/safety/signals',
    {
      config: { rateLimit: rateLimit ?? { max: 30, timeWindow: '1 minute' } },
      schema: {
        response: {
          200: adminSafetySignalsResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeAdminRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        anyOf: ['audit.view'],
      });
      if (!auth.ok) return reply.code(auth.status).send({ error: auth.error });

      const thresholds = {
        awardsPerCashierDay: 50_000,
        redemptionsPerCustomer30d: 60,
        reversalsPerStaff30d: 10,
        adjustmentsPerStaff30d: 20,
      };

      const awards = await db.execute(sql`
        SELECT s.name, s.email, count(*)::int AS count
        FROM points_ledger_entries e
        INNER JOIN staff_users s ON s.id = e.staff_id
        WHERE e.type = 'earn'
          AND (e.created_at AT TIME ZONE 'Europe/Helsinki')::date =
              (now() AT TIME ZONE 'Europe/Helsinki')::date
        GROUP BY s.id, s.name, s.email
        HAVING count(*) > ${thresholds.awardsPerCashierDay}
        ORDER BY count DESC
      `);

      const redemptions = await db.execute(sql`
        SELECT c.name, c.email, count(*)::int AS count
        FROM points_ledger_entries e
        INNER JOIN customers c ON c.id = e.customer_id
        WHERE e.type = 'redeem'
          AND e.created_at >= now() - interval '30 days'
        GROUP BY c.id, c.name, c.email
        HAVING count(*) > ${thresholds.redemptionsPerCustomer30d}
        ORDER BY count DESC
      `);

      const reversals = await db.execute(sql`
        SELECT s.name, s.email, count(*)::int AS count
        FROM points_ledger_entries e
        INNER JOIN staff_users s ON s.id = e.staff_id
        WHERE e.type = 'reversal'
          AND e.created_at >= now() - interval '30 days'
        GROUP BY s.id, s.name, s.email
        HAVING count(*) > ${thresholds.reversalsPerStaff30d}
        ORDER BY count DESC
      `);

      const adjustments = await db.execute(sql`
        SELECT s.name, s.email, count(*)::int AS count
        FROM points_ledger_entries e
        INNER JOIN staff_users s ON s.id = e.staff_id
        WHERE e.type = 'adjust'
          AND e.created_at >= now() - interval '30 days'
        GROUP BY s.id, s.name, s.email
        HAVING count(*) > ${thresholds.adjustmentsPerStaff30d}
        ORDER BY count DESC
      `);

      const subject = (row: Record<string, unknown>): string => {
        const name = typeof row.name === 'string' ? row.name.trim() : '';
        const email = typeof row.email === 'string' ? row.email : '';
        return name === '' ? email : `${name} (${email})`;
      };

      const signals = [
        ...awards.rows.map((row) => ({
          kind: 'awards_per_cashier_day' as const,
          label: 'Awards per cashier today',
          subject: subject(row as Record<string, unknown>),
          count: Number((row as Record<string, unknown>).count ?? 0),
          threshold: thresholds.awardsPerCashierDay,
          window: 'today (Helsinki)',
        })),
        ...redemptions.rows.map((row) => ({
          kind: 'redemptions_per_customer_30d' as const,
          label: 'Redemptions per customer',
          subject: subject(row as Record<string, unknown>),
          count: Number((row as Record<string, unknown>).count ?? 0),
          threshold: thresholds.redemptionsPerCustomer30d,
          window: 'last 30 days',
        })),
        ...reversals.rows.map((row) => ({
          kind: 'reversals_per_staff_30d' as const,
          label: 'Reversals per staff member',
          subject: subject(row as Record<string, unknown>),
          count: Number((row as Record<string, unknown>).count ?? 0),
          threshold: thresholds.reversalsPerStaff30d,
          window: 'last 30 days',
        })),
        ...adjustments.rows.map((row) => ({
          kind: 'adjustments_per_staff_30d' as const,
          label: 'Adjustments per staff member',
          subject: subject(row as Record<string, unknown>),
          count: Number((row as Record<string, unknown>).count ?? 0),
          threshold: thresholds.adjustmentsPerStaff30d,
          window: 'last 30 days',
        })),
      ];

      return reply.send({ thresholds, signals });
    },
  );


  /** Feedback submitted from the platform console itself. */
  app.post(
    '/v1/admin/feedback',
    {
      config: { rateLimit: rateLimit ?? { max: 10, timeWindow: '1 hour' } },
      schema: {
        body: feedbackRequestSchema,
        response: {
          201: feedbackResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeAdminRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        anyOf: ['audit.view'],
      });
      if (!auth.ok) return reply.code(auth.status).send({ error: auth.error });

      const saved = await recordFeedback(db, {
        source: 'admin',
        category: request.body.category,
        message: request.body.message,
        page: request.body.page ?? null,
        staffUserId: auth.staffUserId,
      });

      return reply.code(201).send({
        id: saved.id,
        createdAt: saved.createdAt.toISOString(),
      });
    },
  );

  /** The newest feedback from every surface, for the Support area. */
  app.get(
    '/v1/admin/feedback',
    {
      config: { rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' } },
      schema: {
        response: {
          200: adminFeedbackResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeAdminRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        anyOf: ['audit.view'],
      });
      if (!auth.ok) return reply.code(auth.status).send({ error: auth.error });

      const rows = await listFeedback(db);
      return reply.send({
        feedback: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })),
      });
    },
  );

  /** Support search: a store name, or a customer's email, name or code. */
  app.get(
    '/v1/admin/support',
    {
      config: { rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' } },
      schema: {
        querystring: adminSupportQuerySchema,
        response: {
          200: adminSupportResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeAdminRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        anyOf: ['customers.lookup'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const query = request.query.query;
      const like = `%${query}%`;

      const storeRows = await db
        .select({ storeId: stores.id, name: stores.name, status: stores.status })
        .from(stores)
        .where(sql`${stores.name} ILIKE ${like}`)
        .limit(10);

      const customerRows = await db
        .select({
          customerId: customers.id,
          email: customers.email,
          name: customers.name,
          createdAt: customers.createdAt,
        })
        .from(customers)
        .where(
          and(
            sql`${customers.status} <> 'deleted'`,
            sql`(${customers.email} ILIKE ${like} OR ${customers.name} ILIKE ${like}
              OR EXISTS (
                SELECT 1 FROM credentials c
                WHERE c.customer_id = ${customers.id} AND c.identifier ILIKE ${like}
              ))`,
          ),
        )
        .limit(10);

      const balances =
        customerRows.length === 0
          ? []
          : await db
              .select({
                customerId: pointsBalances.customerId,
                storeId: pointsBalances.storeId,
                storeName: stores.name,
                balance: pointsBalances.balance,
              })
              .from(pointsBalances)
              .innerJoin(stores, eq(stores.id, pointsBalances.storeId))
              .where(inArray(pointsBalances.customerId, customerRows.map((row) => row.customerId)))
              .orderBy(stores.name);

      return reply.send({
        stores: storeRows,
        customers: customerRows.map((row) => ({
          customerId: row.customerId,
          email: row.email,
          name: row.name,
          createdAt: row.createdAt.toISOString(),
          balances: balances
            .filter((entry) => entry.customerId === row.customerId)
            .map((entry) => ({
              storeId: String(entry.storeId),
              storeName: String(entry.storeName),
              balance: Number(entry.balance ?? 0),
            })),
        })),
      });
    },
  );

  /** Platform analytics: the four numbers that describe the business. */
  app.get(
    '/v1/admin/analytics',
    {
      config: { rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' } },
      schema: {
        response: {
          200: adminAnalyticsResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeAdminRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        anyOf: ['audit.view'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const result = await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM stores) AS stores,
          (SELECT count(*)::int FROM stores WHERE status = 'active') AS active_stores,
          (SELECT count(*)::int FROM customers WHERE status <> 'deleted') AS customers,
          (SELECT count(*)::int FROM points_ledger_entries
             WHERE type = 'earn' AND created_at > now() - interval '30 days') AS awards_30d,
          (SELECT count(*)::int FROM points_ledger_entries
             WHERE type = 'redeem' AND created_at > now() - interval '30 days') AS redemptions_30d,
          (SELECT coalesce(sum(balance), 0)::int FROM points_balances) AS outstanding_points
      `);
      const row = (result.rows[0] ?? {}) as Record<string, number | null>;

      return reply.send({
        stores: Number(row.stores ?? 0),
        activeStores: Number(row.active_stores ?? 0),
        customers: Number(row.customers ?? 0),
        awards30d: Number(row.awards_30d ?? 0),
        redemptions30d: Number(row.redemptions_30d ?? 0),
        outstandingPoints: Number(row.outstanding_points ?? 0),
      });
    },
  );

  /** Subscriptions as they stand; billing is not connected yet. */
  app.get(
    '/v1/admin/subscriptions',
    {
      config: { rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' } },
      schema: {
        response: {
          200: adminSubscriptionsResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeAdminRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        anyOf: ['audit.view'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const rows = await db
        .select({
          storeId: subscriptions.storeId,
          storeName: stores.name,
          plan: subscriptions.plan,
          status: subscriptions.status,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
          firstFailedPaymentAt: subscriptions.firstFailedPaymentAt,
        })
        .from(subscriptions)
        .innerJoin(stores, eq(stores.id, subscriptions.storeId))
        .orderBy(stores.name);

      return reply.send({
        subscriptions: rows.map((row) => ({
          storeId: row.storeId,
          storeName: row.storeName,
          plan: row.plan,
          status: row.status,
          currentPeriodEnd:
            row.currentPeriodEnd === null ? null : row.currentPeriodEnd.toISOString(),
          firstFailedPaymentAt:
            row.firstFailedPaymentAt === null ? null : row.firstFailedPaymentAt.toISOString(),
        })),
      });
    },
  );

};

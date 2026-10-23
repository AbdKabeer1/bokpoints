import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { earningRuleDefinitionSchema } from '@bokpoints/shared';
import {
  apiErrorSchema,
  awardPreviewResponseSchema,
  awardRequestSchema,
  awardResponseSchema,
  balanceResponseSchema,
  customerParamsSchema,
  earningRuleCreateRequestSchema,
  earningRuleEditRequestSchema,
  earningRuleParamsSchema,
  earningRuleRowSchema,
  earningRuleStatusRequestSchema,
  earningRulesResponseSchema,
  identifyRequestSchema,
  identifyResponseSchema,
  recentAwardsQuerySchema,
  recentAwardsResponseSchema,
  reversalRequestSchema,
  reversalResponseSchema,
  saleIdParamsSchema,
  rewardCreateRequestSchema,
  rewardEditRequestSchema,
  rewardParamsSchema,
  storeRewardRowSchema,
  storeRewardsResponseSchema,
  tillRewardsQuerySchema,
  tillRewardsResponseSchema,
  idempotencyKeyHeaderSchema,
  ruleSimulateRequestSchema,
  ruleSimulateResponseSchema,
  storeIdParamsSchema,
  calculatePurchase,
} from '@bokpoints/shared';
import type { LedgerErrorCode } from '../db/ledger.js';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authorizeStoreRequest } from '../auth/authorize.js';
import type { SessionResolver } from '../auth/session.js';
import type { Database } from '../db/client.js';
import {
  getBalance,
  LedgerError,
  previewEarn,
  recordEarn,
  reverseSale,
  rewardTakesToday,
} from '../db/ledger.js';
import {
  auditLogEntries,
  credentials,
  customers,
  earningRules,
  pointsLedgerEntries,
  sales,
  storeRewards,
  stores,
} from '../db/schema.js';
import {
  conditionsFromDefinition,
  currentProgramFor,
  engineRuleFromDefinition,
  listStoreRules,
  nextStoreRuleVersion,
  paramsFromDefinition,
  ruleDefinitionFromRow,
  type RuleDefinition,
  type StoredRule,
} from '../db/earning-rules.js';

export interface RouteOptions {
  db: Database;
  sessionResolver?: SessionResolver | undefined;
  rateLimit?: { max: number; timeWindow: string } | undefined;
}

const bearer = (header: string | undefined): string | undefined =>
  header?.replace(/^Bearer\s+/i, '').trim() || undefined;

/**
 * How a ledger failure is reported over HTTP.
 */
export const LEDGER_ERROR_STATUS = {
  BELOW_MINIMUM: 400,
  INVALID_AMOUNT: 400,
  REASON_REQUIRED: 400,
  BALANCE_WOULD_GO_NEGATIVE: 409,
  STORE_NOT_AWARDING: 403,
  CUSTOMER_NOT_FOUND: 404,
  IDEMPOTENCY_KEY_REUSED: 409,
  LOCATION_REQUIRED: 400,
  LOCATION_INVALID: 400,
  SALE_NOT_FOUND: 404,
  SALE_ALREADY_REVERSED: 409,
  REWARD_NOT_FOUND: 404,
  REWARD_NOT_ACTIVE: 409,
  REWARD_NOT_AFFORDABLE: 409,
  REWARD_LIMIT_REACHED: 409,
} as const satisfies Record<LedgerErrorCode, number>;

/**
 * The three operations the Cashier screen needs, and that a future POS
 * integration will use through the same API (FR-API-1): identify a customer,
 * award points, get a balance.
 */
export const storeRoutes: FastifyPluginAsyncZod<RouteOptions> = async (app, options) => {
  const { db, sessionResolver, rateLimit } = options;

  /**
   * Resolve a credential to a customer. The cashier sees the first name and,
   * when online, the balance at this store (FR-STO-9).
   */
  app.post(
    '/v1/stores/:storeId/identify',
    {
      config: {
        rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' },
      },
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

      // FR-CRD-4: a lost or revoked credential is refused at once, and a
      // credential past its validity is refused too.
      const rows = await db
        .select({
          customerId: credentials.customerId,
          name: customers.name,
          status: credentials.status,
          validUntil: credentials.validUntil,
          customerStatus: customers.status,
        })
        .from(credentials)
        .innerJoin(customers, eq(credentials.customerId, customers.id))
        .where(
          and(
            eq(credentials.identifier, request.body.credentialIdentifier),
            eq(credentials.type, request.body.credentialType),
          ),
        )
        .limit(1);

      const found = rows[0];
      const now = new Date();
      const usable =
        found !== undefined &&
        found.status === 'active' &&
        found.customerStatus !== 'deleted' &&
        (found.validUntil === null || found.validUntil.getTime() > now.getTime());

      if (!usable) {
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
      config: {
        rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' },
      },
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
          404: apiErrorSchema,
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

      const program = await currentProgramFor(db, storeId);
      if (!program) {
        return reply
          .code(409)
          .send({
            error: { code: 'NO_ACTIVE_RULE', message: 'This store has no earning rules yet' },
          });
      }

      // D-103: a member limited to one branch awards at that branch. Naming
      // a different one is refused, not quietly overridden.
      if (
        auth.locationId !== null &&
        request.body.locationId !== undefined &&
        request.body.locationId !== auth.locationId
      ) {
        return reply.code(403).send({
          error: {
            code: 'LOCATION_MISMATCH',
            message: 'You are limited to a different branch of this store',
          },
        });
      }
      const locationId = auth.locationId ?? request.body.locationId ?? null;

      let result;
      try {
        result = await recordEarn(db, {
          customerId: request.body.customerId,
          storeId,
          amountCents: request.body.amountCents,
          ...(request.body.amountPaidCents === undefined
            ? {}
            : { amountPaidCents: request.body.amountPaidCents }),
          ...(request.body.posReference === undefined ? {} : { posReference: request.body.posReference }),
          ...(request.body.redeemRewardId === undefined
            ? {}
            : { redeemRewardId: request.body.redeemRewardId }),
          program,
          idempotencyKey,
          staffId: auth.staffUserId,
          locationId,
        });
      } catch (error) {
        if (error instanceof LedgerError) {
          return reply
            .code(LEDGER_ERROR_STATUS[error.code] ?? 400)
            .send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }

      // 201 only when this request created an award. A replay of a request
      // that was already awarded, and a purchase that awards nothing, are
      // both a plain success: 200.
      const status = result.awarded && !result.replayed ? 201 : 200;
      return reply.code(status).send({
        entryId: result.entryId,
        saleId: result.saleId,
        redeemed: result.redeemed,
        points: result.points,
        awarded: result.awarded,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
        breakdown: result.breakdown ?? [],
      });
    },
  );

  /**
   * What this purchase will earn, before the cashier commits (FR-STO-9).
   *
   * Same body, same capability and same branch rules as the award, and it
   * writes nothing: the points maths stays here, where the rule version is
   * authoritative, instead of being copied into the browser.
   */
  app.post(
    '/v1/stores/:storeId/awards/preview',
    {
      config: {
        rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' },
      },
      schema: {
        params: storeIdParamsSchema,
        body: awardRequestSchema,
        response: {
          200: awardPreviewResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
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

      const program = await currentProgramFor(db, storeId);
      if (!program) {
        return reply.code(409).send({
          error: { code: 'NO_ACTIVE_RULE', message: 'This store has no earning rules yet' },
        });
      }

      // The same branch rule as the award itself (D-103, D-104).
      if (
        auth.locationId !== null &&
        request.body.locationId !== undefined &&
        request.body.locationId !== auth.locationId
      ) {
        return reply.code(403).send({
          error: {
            code: 'LOCATION_MISMATCH',
            message: 'You are limited to a different branch of this store',
          },
        });
      }
      const locationId = auth.locationId ?? request.body.locationId ?? null;

      try {
        const result = await previewEarn(db, {
          customerId: request.body.customerId,
          storeId,
          amountCents: request.body.amountCents,
          ...(request.body.amountPaidCents === undefined
            ? {}
            : { amountPaidCents: request.body.amountPaidCents }),
          ...(request.body.redeemRewardId === undefined
            ? {}
            : { redeemRewardId: request.body.redeemRewardId }),
          program,
          locationId,
        });

        return reply.send({
          customerId: request.body.customerId,
          points: result.points,
          awarded: result.awarded,
          ...(result.reason === undefined ? {} : { reason: result.reason }),
          expiresAt: result.expiresAt === null ? null : result.expiresAt.toISOString().slice(0, 10),
          locationId: result.locationId,
          locationName: result.locationName,
          breakdown: result.breakdown ?? [],
          redeemed: result.redeemed,
        });
      } catch (error) {
        if (error instanceof LedgerError) {
          return reply
            .code(LEDGER_ERROR_STATUS[error.code] ?? 400)
            .send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    },
  );

  /* ── Rewards catalog and redemption (D-138) ───────────────────────────── */

  const rewardRow = (reward: {
    id: string;
    name: string;
    pointsCost: number;
    perCustomerPerDayLimit: number | null;
    active: boolean;
    createdAt: Date;
  }) => ({
    rewardId: reward.id,
    name: reward.name,
    pointsCost: reward.pointsCost,
    perCustomerPerDayLimit: reward.perCustomerPerDayLimit,
    active: reward.active,
    createdAt: reward.createdAt.toISOString(),
  });

  /**
   * The store's catalog (D-138). Owners and managers shape it; cashiers
   * never edit it. The till reads what a customer can afford through
   * `rewards/available`, and the customer app sees the plain list.
   */
  app.get(
    '/v1/stores/:storeId/rewards',
    {
      config: {
        rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' },
      },
      schema: {
        params: storeIdParamsSchema,
        response: {
          200: storeRewardsResponseSchema,
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
        anyOf: ['rewards.manage'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const rows = await db
        .select()
        .from(storeRewards)
        .where(eq(storeRewards.storeId, storeId))
        .orderBy(desc(storeRewards.createdAt));
      return reply.send({ rewards: rows.map(rewardRow) });
    },
  );

  app.post(
    '/v1/stores/:storeId/rewards',
    {
      config: {
        rateLimit: rateLimit ?? { max: 30, timeWindow: '1 minute' },
      },
      schema: {
        params: storeIdParamsSchema,
        body: rewardCreateRequestSchema,
        response: {
          201: storeRewardRowSchema,
          400: apiErrorSchema,
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
        anyOf: ['rewards.manage'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const inserted = await db
        .insert(storeRewards)
        .values({
          storeId,
          name: request.body.name,
          pointsCost: request.body.pointsCost,
          perCustomerPerDayLimit: request.body.perCustomerPerDayLimit ?? null,
        })
        .returning();
      const reward = inserted[0];
      if (!reward) {
        throw new Error('Could not create the reward');
      }

      await db.insert(auditLogEntries).values({
        actorId: auth.staffUserId,
        action: 'reward.create',
        storeId,
        targetType: 'reward',
        targetId: reward.id,
        after: {
          name: reward.name,
          pointsCost: reward.pointsCost,
          perCustomerPerDayLimit: reward.perCustomerPerDayLimit,
        },
      });

      return reply.code(201).send(rewardRow(reward));
    },
  );

  /**
   * Editing a reward changes it in place — unlike earning rules, which
   * version (D-116): a reward's past is already frozen into the ledger
   * entries that took it, so the row only speaks for future takes.
   */
  app.post(
    '/v1/stores/:storeId/rewards/:rewardId',
    {
      config: {
        rateLimit: rateLimit ?? { max: 30, timeWindow: '1 minute' },
      },
      schema: {
        params: rewardParamsSchema,
        body: rewardEditRequestSchema,
        response: {
          200: storeRewardRowSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { storeId, rewardId } = request.params;
      const auth = await authorizeStoreRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        storeId,
        anyOf: ['rewards.manage'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const current = await db
        .select()
        .from(storeRewards)
        .where(and(eq(storeRewards.id, rewardId), eq(storeRewards.storeId, storeId)))
        .limit(1);
      const reward = current[0];
      if (!reward) {
        return reply.code(404).send({
          error: { code: 'REWARD_NOT_FOUND', message: 'That reward does not exist at this store' },
        });
      }

      const updatedRows = await db
        .update(storeRewards)
        .set({
          ...(request.body.name === undefined ? {} : { name: request.body.name }),
          ...(request.body.pointsCost === undefined ? {} : { pointsCost: request.body.pointsCost }),
          ...(request.body.perCustomerPerDayLimit === undefined
            ? {}
            : { perCustomerPerDayLimit: request.body.perCustomerPerDayLimit ?? null }),
          ...(request.body.active === undefined ? {} : { active: request.body.active }),
        })
        .where(eq(storeRewards.id, rewardId))
        .returning();
      const updated = updatedRows[0] ?? reward;

      await db.insert(auditLogEntries).values({
        actorId: auth.staffUserId,
        action: 'reward.edit',
        storeId,
        targetType: 'reward',
        targetId: rewardId,
        before: {
          name: reward.name,
          pointsCost: reward.pointsCost,
          perCustomerPerDayLimit: reward.perCustomerPerDayLimit,
          active: reward.active,
        },
        after: {
          name: updated.name,
          pointsCost: updated.pointsCost,
          perCustomerPerDayLimit: updated.perCustomerPerDayLimit,
          active: updated.active,
        },
      });

      return reply.send(rewardRow(updated));
    },
  );

  /**
   * The till's picker (D-138): every active reward, with what this
   * customer can take right now — their balance against the cost, and
   * whether the per-customer daily limit is already used up today.
   */
  app.get(
    '/v1/stores/:storeId/rewards/available',
    {
      config: {
        rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' },
      },
      schema: {
        params: storeIdParamsSchema,
        querystring: tillRewardsQuerySchema,
        response: {
          200: tillRewardsResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { storeId } = request.params;
      const { customerId } = request.query;
      const auth = await authorizeStoreRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        storeId,
        anyOf: ['points.award', 'points.redeem'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const balance = await getBalance(db, customerId, storeId);

      // D-145: the purchase being confirmed earns points too, and the
      // confirm lets them pay for a reward. The picker projects that earn
      // with the same engine the quote uses, so what it offers is exactly
      // what the confirm will accept.
      let projectedEarn = 0;
      if (request.query.paidCents !== undefined) {
        const program = await currentProgramFor(db, storeId);
        if (program) {
          try {
            const preview = await previewEarn(db, {
              customerId,
              storeId,
              amountCents: request.query.paidCents,
              program,
              locationId: auth.locationId,
            });
            projectedEarn = preview.awarded ? preview.points : 0;
          } catch {
            // An unpriceable purchase (no rules, paused store) just means
            // the picker falls back to the balance alone.
            projectedEarn = 0;
          }
        }
      }

      const rows = await db
        .select({
          id: storeRewards.id,
          name: storeRewards.name,
          pointsCost: storeRewards.pointsCost,
          perCustomerPerDayLimit: storeRewards.perCustomerPerDayLimit,
        })
        .from(storeRewards)
        .where(and(eq(storeRewards.storeId, storeId), eq(storeRewards.active, true)))
        .orderBy(asc(storeRewards.pointsCost));

      const rewards = [];
      for (const row of rows) {
        const redeemedToday = await rewardTakesToday(db, customerId, storeId, row.id);
        const limitReached =
          row.perCustomerPerDayLimit !== null && redeemedToday >= row.perCustomerPerDayLimit;
        rewards.push({
          rewardId: row.id,
          name: row.name,
          pointsCost: row.pointsCost,
          affordable: !limitReached && balance + projectedEarn >= row.pointsCost,
          redeemedToday,
          limitReached,
        });
      }

      return reply.send({ balance, rewards });
    },
  );

  /** The customer's balance at this store. Never another store's balance. */
  /**
   * The till's own recent awards (FR-STO-9): what this cashier last
   * recorded at this store, newest first, so the queue can be checked at
   * a glance. Cashiers see their own; the store owner sees the same
   * history through the audit log.
   */
  app.get(
    '/v1/stores/:storeId/awards/recent',
    {
      config: {
        rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' },
      },
      schema: {
        params: storeIdParamsSchema,
        querystring: recentAwardsQuerySchema,
        response: {
          200: recentAwardsResponseSchema,
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
        anyOf: ['points.award'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const rows = await db
        .select({
          entryId: pointsLedgerEntries.id,
          customerName: customers.name,
          points: pointsLedgerEntries.points,
          amountCents: pointsLedgerEntries.amountCents,
          breakdown: pointsLedgerEntries.rulesApplied,
          createdAt: pointsLedgerEntries.createdAt,
        })
        .from(pointsLedgerEntries)
        .innerJoin(customers, eq(customers.id, pointsLedgerEntries.customerId))
        .where(
          and(
            eq(pointsLedgerEntries.storeId, storeId),
            eq(pointsLedgerEntries.staffId, auth.staffUserId),
            eq(pointsLedgerEntries.type, 'earn'),
          ),
        )
        .orderBy(desc(pointsLedgerEntries.createdAt))
        .limit(request.query.limit);

      return reply.code(200).send({
        entries: rows.map((row) => ({
          entryId: row.entryId,
          customerName: row.customerName,
          points: row.points,
          amountCents: row.amountCents,
          breakdown: Array.isArray(row.breakdown) ? row.breakdown : null,
          createdAt: row.createdAt.toISOString(),
        })),
      });
    },
  );

  /**
   * Reverses one confirmed sale (WP3, D-131): the sale's points come back
   * off, the reversal entry names the entry it reverses, and the sale is
   * marked reversed so the same one cannot be undone twice. Cashier-level
   * capability — the same hands that may award may undo (D-132's device
   * scope for reversals points the same way); every reversal is audited.
   */
  app.post(
    '/v1/stores/:storeId/sales/:saleId/reversal',
    {
      config: {
        rateLimit: rateLimit ?? { max: 30, timeWindow: '1 minute' },
      },
      schema: {
        params: saleIdParamsSchema,
        body: reversalRequestSchema,
        response: {
          200: reversalResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { storeId, saleId } = request.params;
      const auth = await authorizeStoreRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        storeId,
        anyOf: ['points.award'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      // Reversal policy (D-143): the sale's own cashier may undo it for a
      // short window after recording it; after that only an owner or a
      // manager may. A branch-limited member may only reverse sales of
      // their own branch, whatever their role. The reason is required.
      const saleRows = await db
        .select({
          staffId: sales.staffId,
          locationId: sales.locationId,
          createdAt: sales.createdAt,
        })
        .from(sales)
        .where(and(eq(sales.id, saleId), eq(sales.storeId, storeId)))
        .limit(1);
      const sale = saleRows[0];
      if (!sale) {
        return reply.code(404).send({
          error: { code: 'SALE_NOT_FOUND', message: 'That sale does not exist at this store' },
        });
      }

      const REVERSAL_WINDOW_MS = 15 * 60 * 1000;
      if (
        auth.role === 'cashier' &&
        (sale.staffId !== auth.staffUserId ||
          Date.now() - sale.createdAt.getTime() > REVERSAL_WINDOW_MS)
      ) {
        return reply.code(403).send({
          error: {
            code: 'REVERSAL_NOT_ALLOWED',
            message:
              'Only the cashier who recorded the sale can reverse it in the first 15 minutes — ask the owner or a manager',
          },
        });
      }
      if (auth.locationId !== null && sale.locationId !== auth.locationId) {
        return reply.code(403).send({
          error: {
            code: 'LOCATION_MISMATCH',
            message: 'That sale was recorded at a different branch',
          },
        });
      }

      try {
        const result = await reverseSale(db, {
          saleId,
          storeId,
          staffId: auth.staffUserId,
          reason: request.body.reason,
        });
        return reply.code(200).send({
          reversalEntryId: result.reversalEntryId,
          reversedPoints: result.reversedPoints,
          restoredPoints: result.restoredPoints,
          balance: result.balance,
        });
      } catch (error) {
        if (error instanceof LedgerError) {
          return reply
            .code(LEDGER_ERROR_STATUS[error.code] ?? 400)
            .send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    },
  );

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

  /**
   * The owner's rule controls (WP2, FR-RUL). The history is append-only:
   * creating and editing always land as a new store-wide version, and the
   * old rows keep their place (D-116, FR-RUL-4). Cashiers read nothing
   * here; the capability is points_rule.manage (owner, manager, admin).
   */
  // The zod schema and the engine agree by construction; TS only sees the
  // engine's 'floor' | 'nearest' | undefined against the schema's narrowed
  // required field, so the one narrowing happens here, in one place.
  type RuleRowResponse = z.infer<typeof earningRuleRowSchema>;
  const ruleRowResponse = (rule: StoredRule): RuleRowResponse => ({
    ruleId: rule.id,
    ruleKey: rule.ruleKey,
    definition: rule.definition as RuleRowResponse['definition'],
    version: rule.version,
    status: rule.status,
    effectiveFrom: rule.effectiveFrom.toISOString(),
    createdAt: rule.createdAt.toISOString(),
  });

  /**
   * A zod-parsed definition into the engine's exact shape: this repo compiles
   * with exactOptionalPropertyTypes, so an explicit omission is the honest
   * translation of "optional, not undefined".
   */
  const cleanDefinition = (value: z.infer<typeof earningRuleDefinitionSchema>): RuleDefinition => {
    switch (value.type) {
      case 'per_euro':
        return {
          type: 'per_euro',
          pointsPerEuroThousandths: value.pointsPerEuroThousandths,
          rounding: value.rounding,
          ...(value.minSpendCents === undefined ? {} : { minSpendCents: value.minSpendCents }),
        };
      case 'fixed_per_purchase':
        return {
          type: 'fixed_per_purchase',
          points: value.points,
          ...(value.minSpendCents === undefined ? {} : { minSpendCents: value.minSpendCents }),
        };
      case 'threshold_bonus':
        return {
          type: 'threshold_bonus',
          points: value.points,
          ...(value.minSpendCents === undefined ? {} : { minSpendCents: value.minSpendCents }),
        };
      case 'every_nth_visit':
        return { type: 'every_nth_visit', points: value.points, everyN: value.everyN };
    }
    throw new Error('Unknown rule type');
  };

  /** The engine holds the technical limits, so validation runs through it. */
  const definitionError = (definition: RuleDefinition): string | null => {
    try {
      calculatePurchase({
        lines: [{ amountCents: 100 }],
        rules: [engineRuleFromDefinition(definition)],
        visitNumber: 1,
      });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'That rule does not pass the limits';
    }
  };

  app.get(
    '/v1/stores/:storeId/rules',
    {
      schema: {
        params: storeIdParamsSchema,
        response: {
          200: earningRulesResponseSchema,
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
        anyOf: ['points_rule.manage'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const rules = await listStoreRules(db, storeId);
      if (rules === null) {
        return reply.code(404).send({ error: { code: 'STORE_NOT_FOUND', message: 'No such store' } });
      }
      return reply.code(200).send({ rules: rules.map(ruleRowResponse) });
    },
  );

  app.post(
    '/v1/stores/:storeId/rules',
    {
      schema: {
        params: storeIdParamsSchema,
        body: earningRuleCreateRequestSchema,
        response: {
          201: earningRuleRowSchema,
          400: apiErrorSchema,
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
        anyOf: ['points_rule.manage'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const store = await db
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.id, storeId))
        .limit(1);
      if (!store[0]) {
        return reply.code(404).send({ error: { code: 'STORE_NOT_FOUND', message: 'No such store' } });
      }

      const { effectiveFrom } = request.body;
      const definition = cleanDefinition(request.body.definition);
      const invalid = definitionError(definition);
      if (invalid !== null) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_RULE', message: invalid } });
      }

      const created = await db.transaction(async (tx) => {
        const version = await nextStoreRuleVersion(tx, storeId);
        const inserted = await tx
          .insert(earningRules)
          .values({
            storeId,
            ruleKey: randomUUID(),
            type: definition.type,
            params: paramsFromDefinition(definition),
            conditions: conditionsFromDefinition(definition),
            effectiveFrom: effectiveFrom === undefined ? new Date() : new Date(effectiveFrom),
            status: 'active',
            version,
            createdBy: auth.staffUserId,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('Could not create the rule');

        await tx.insert(auditLogEntries).values({
          actorId: auth.staffUserId,
          actorRole: auth.role,
          action: 'rule.create',
          storeId,
          targetType: 'earning_rule',
          targetId: row.id,
          after: { definition, version },
        });

        return row;
      });

      return reply.code(201).send(
        ruleRowResponse({
          id: created.id,
          ruleKey: created.ruleKey,
          definition,
          version: created.version,
          status: 'active',
          effectiveFrom: created.effectiveFrom,
          createdAt: created.createdAt,
        }),
      );
    },
  );

  /** A draft or the store's current rules into the engine, ledger untouched. */
  app.post(
    '/v1/stores/:storeId/rules/simulate',
    {
      schema: {
        params: storeIdParamsSchema,
        body: ruleSimulateRequestSchema,
        response: {
          200: ruleSimulateResponseSchema,
          400: apiErrorSchema,
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
        anyOf: ['points_rule.manage'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const store = await db
        .select({ maxPointsPerSale: stores.maxPointsPerSale })
        .from(stores)
        .where(eq(stores.id, storeId))
        .limit(1);
      if (!store[0]) {
        return reply.code(404).send({ error: { code: 'STORE_NOT_FOUND', message: 'No such store' } });
      }

      const { amountCents, visitNumber, rules: draftRules } = request.body;
      let rulesSource: 'store' | 'draft';
      let rules;
      let maxPointsPerSale: number | undefined = store[0].maxPointsPerSale ?? undefined;

      if (draftRules !== undefined) {
        rulesSource = 'draft';
        const definitions = draftRules.map(cleanDefinition);
        rules = definitions.map((definition) => engineRuleFromDefinition(definition));
        for (const definition of definitions) {
          const invalid = definitionError(definition);
          if (invalid !== null) {
            return reply
              .code(400)
              .send({ error: { code: 'INVALID_RULE', message: invalid } });
          }
        }
      } else {
        const program = await currentProgramFor(db, storeId);
        if (program === null || program.rules.length === 0) {
          return reply.code(400).send({
            error: { code: 'RULES_EMPTY', message: 'This store has no rules to simulate' },
          });
        }
        rulesSource = 'store';
        rules = program.rules;
        maxPointsPerSale = program.maxPointsPerSale;
      }

      const result = calculatePurchase({
        lines: [{ amountCents }],
        rules: rules as never,
        ...(maxPointsPerSale === undefined ? {} : { maxPointsPerSale }),
        visitNumber: visitNumber ?? 1,
      });

      return reply.code(200).send({
        points: result.points,
        uncappedPoints: result.uncappedPoints,
        capped: result.capped,
        awarded: result.awarded,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
        breakdown: result.breakdown,
        rulesSource,
      });
    },
  );

  /** Editing never rewrites history: the change is a new version (FR-RUL-4). */
  app.post(
    '/v1/stores/:storeId/rules/:ruleId/version',
    {
      schema: {
        params: earningRuleParamsSchema,
        body: earningRuleEditRequestSchema,
        response: {
          201: earningRuleRowSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { storeId, ruleId } = request.params;
      const auth = await authorizeStoreRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        storeId,
        anyOf: ['points_rule.manage'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const existing = await db
        .select()
        .from(earningRules)
        .where(and(eq(earningRules.id, ruleId), eq(earningRules.storeId, storeId)))
        .limit(1);
      const previous = existing[0];
      if (!previous) {
        return reply
          .code(404)
          .send({ error: { code: 'RULE_NOT_FOUND', message: 'No such rule at this store' } });
      }
      if (previous.status === 'superseded') {
        return reply.code(409).send({
          error: {
            code: 'RULE_SUPERSEDED',
            message: 'A superseded version is history and cannot be edited',
          },
        });
      }

      const definition = cleanDefinition(request.body.definition);
      const invalid = definitionError(definition);
      if (invalid !== null) {
        return reply.code(400).send({ error: { code: 'INVALID_RULE', message: invalid } });
      }

      const created = await db.transaction(async (tx) => {
        const version = await nextStoreRuleVersion(tx, storeId);
        const inserted = await tx
          .insert(earningRules)
          .values({
            storeId,
            ruleKey: previous.ruleKey,
            type: definition.type,
            params: paramsFromDefinition(definition),
            conditions: conditionsFromDefinition(definition),
            effectiveFrom:
              request.body.effectiveFrom === undefined ? new Date() : new Date(request.body.effectiveFrom),
            status: 'active',
            version,
            createdBy: auth.staffUserId,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('Could not create the rule version');

        await tx
          .update(earningRules)
          .set({ status: 'superseded' })
          .where(eq(earningRules.id, ruleId));

        await tx.insert(auditLogEntries).values({
          actorId: auth.staffUserId,
          actorRole: auth.role,
          action: 'rule.version',
          storeId,
          targetType: 'earning_rule',
          targetId: ruleId,
          before: { definition: ruleDefinitionFromRow(previous), version: previous.version },
          after: { definition, version },
        });

        return row;
      });

      return reply.code(201).send(
        ruleRowResponse({
          id: created.id,
          ruleKey: created.ruleKey,
          definition,
          version: created.version,
          status: 'active',
          effectiveFrom: created.effectiveFrom,
          createdAt: created.createdAt,
        }),
      );
    },
  );

  app.post(
    '/v1/stores/:storeId/rules/:ruleId/status',
    {
      schema: {
        params: earningRuleParamsSchema,
        body: earningRuleStatusRequestSchema,
        response: {
          200: earningRuleRowSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { storeId, ruleId } = request.params;
      const auth = await authorizeStoreRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        storeId,
        anyOf: ['points_rule.manage'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const existing = await db
        .select()
        .from(earningRules)
        .where(and(eq(earningRules.id, ruleId), eq(earningRules.storeId, storeId)))
        .limit(1);
      const row = existing[0];
      if (!row) {
        return reply
          .code(404)
          .send({ error: { code: 'RULE_NOT_FOUND', message: 'No such rule at this store' } });
      }
      if (row.status === 'superseded') {
        return reply.code(409).send({
          error: {
            code: 'RULE_SUPERSEDED',
            message: 'A superseded version is history and cannot be paused or resumed',
          },
        });
      }
      if (row.status !== request.body.status) {
        await db.transaction(async (tx) => {
          await tx
            .update(earningRules)
            .set({ status: request.body.status })
            .where(eq(earningRules.id, ruleId));
          await tx.insert(auditLogEntries).values({
            actorId: auth.staffUserId,
            actorRole: auth.role,
            action: 'rule.status',
            storeId,
            targetType: 'earning_rule',
            targetId: ruleId,
            before: { status: row.status },
            after: { status: request.body.status },
          });
        });
      }

      return reply.code(200).send(
        ruleRowResponse({
          id: row.id,
          ruleKey: row.ruleKey,
          definition: ruleDefinitionFromRow(row),
          version: row.version,
          status: request.body.status,
          effectiveFrom: row.effectiveFrom,
          createdAt: row.createdAt,
        }),
      );
    },
  );
};


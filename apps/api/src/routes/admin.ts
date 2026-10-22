import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apiErrorSchema,
  createdStoreResponseSchema,
  createStoreRequestSchema,
} from '@bokpoints/shared';
import { authorizeAdminRequest } from '../auth/authorize.js';
import type { SessionResolver } from '../auth/session.js';
import type { Database } from '../db/client.js';
import {
  auditLogEntries,
  pointsRules,
  storeLocations,
  storeMembers,
  stores,
} from '../db/schema.js';
import { upsertStaffAccount } from '../db/staff.js';
import type { RouteOptions } from './stores.js';

const bearer = (header: string | undefined): string | undefined =>
  header?.replace(/^Bearer\s+/i, '').trim() || undefined;

/**
 * Platform operations, all admin-only (FRD section 2): creating stores with
 * their first points rule, branches and first owner.
 */
export const adminRoutes: FastifyPluginAsyncZod<RouteOptions> = async (app, options) => {
  const { db, sessionResolver, rateLimit } = options;

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

      const created = await db.transaction(async (tx) => {
        const insertedStore = await tx
          .insert(stores)
          .values({
            name: body.name,
            ...(body.address === undefined ? {} : { address: body.address }),
            ...(body.contactName === undefined ? {} : { contactName: body.contactName }),
            ...(body.contactEmail === undefined ? {} : { contactEmail: body.contactEmail }),
            status: 'active',
          })
          .returning({ id: stores.id });
        const storeId = insertedStore[0]?.id;
        if (!storeId) throw new Error('Could not create the store');

        await tx.insert(pointsRules).values({
          storeId,
          ruleVersion: 1,
          pointsPerEuroThousandths: body.pointsRule.pointsPerEuroThousandths,
          rounding: body.pointsRule.rounding,
          minPurchaseCents: body.pointsRule.minPurchaseCents ?? null,
          maxPointsPerTransaction: body.pointsRule.maxPointsPerTransaction ?? null,
          activeFrom: new Date(),
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

        // D-094: the upsert is idempotent by email, so re-running an invite
        // changes nothing instead of failing on a duplicate.
        const ownerId = await upsertStaffAccount(tx, {
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
};

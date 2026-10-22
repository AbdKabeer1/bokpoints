import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apiErrorSchema,
  invitedStaffResponseSchema,
  inviteStaffRequestSchema,
  storeIdParamsSchema,
} from '@bokpoints/shared';
import { authorizeStoreRequest } from '../auth/authorize.js';
import type { SessionResolver } from '../auth/session.js';
import type { Database } from '../db/client.js';
import { auditLogEntries, storeLocations, storeMembers } from '../db/schema.js';
import { upsertStaffAccount } from '../db/staff.js';
import type { RouteOptions } from './stores.js';

const bearer = (header: string | undefined): string | undefined =>
  header?.replace(/^Bearer\s+/i, '').trim() || undefined;

/**
 * Staff management inside one store (FRD section 2): an owner may invite
 * managers and cashiers, a manager may invite cashiers ("cashiers only"),
 * and the admin may do either. Ownership is not invitable (D-107).
 */
export const staffRoutes: FastifyPluginAsyncZod<RouteOptions> = async (app, options) => {
  const { db, sessionResolver, rateLimit } = options;

  app.post(
    '/v1/stores/:storeId/staff',
    {
      config: {
        rateLimit: rateLimit ?? { max: 30, timeWindow: '1 minute' },
      },
      schema: {
        params: storeIdParamsSchema,
        body: inviteStaffRequestSchema,
        response: {
          201: invitedStaffResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { storeId } = request.params;
      // Store membership is checked before any capability is considered
      // (FR-PRV-4), and staff.manage / staff.manage_cashier inside it.
      const auth = await authorizeStoreRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        storeId,
        anyOf: ['staff.manage', 'staff.manage_cashier'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const body = request.body;

      // FRD section 2: a manager may add and remove staff, "cashiers only".
      // The route gate stereotyped that with staff.manage_cashier; the
      // invited role is narrowed here, per caller, from the database role.
      if (auth.role === 'store_manager' && body.role !== 'cashier') {
        return reply.code(403).send({
          error: {
            code: 'FORBIDDEN_ROLE',
            message: 'A manager may only invite cashiers',
          },
        });
      }

      // D-103: a branch limit must name an active branch of this store. A
      // closed branch, a branch of another store, or a made-up id is
      // refused, never quietly ignored.
      if (body.locationId !== undefined) {
        const rows = await db
          .select({ id: storeLocations.id })
          .from(storeLocations)
          .where(
            and(
              eq(storeLocations.id, body.locationId),
              eq(storeLocations.storeId, storeId),
              eq(storeLocations.status, 'active'),
            ),
          );
        if (rows[0] === undefined) {
          return reply.code(400).send({
            error: {
              code: 'LOCATION_INVALID',
              message: 'That branch does not exist or is not open at this store',
            },
          });
        }
      }
      const locationId = body.locationId ?? null;

      const created = await db.transaction(async (tx) => {
        const userId = await upsertStaffAccount(tx, {
          email: body.email,
          name: body.name,
          authUserId: body.authUserId,
          isAdmin: false,
        });

        const inserted = await tx
          .insert(storeMembers)
          .values({ storeId, userId, role: body.role, locationId })
          .returning({ id: storeMembers.id });
        const memberId = inserted[0]?.id;
        if (!memberId) throw new Error('Could not create the membership');

        await tx.insert(auditLogEntries).values({
          actorId: auth.staffUserId,
          actorRole: auth.role,
          action: 'staff.invite',
          storeId,
          targetType: 'staff',
          targetId: memberId,
          after: { role: body.role, locationId },
        });

        return memberId;
      });

      return reply.code(201).send({
        memberId: created,
        storeId,
        role: body.role,
        locationId,
        status: 'active',
      });
    },
  );
};

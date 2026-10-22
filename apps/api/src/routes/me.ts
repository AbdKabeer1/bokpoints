import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { apiErrorSchema, meResponseSchema } from '@bokpoints/shared';
import { authorizeStaffRequest } from '../auth/authorize.js';
import { staffUsers, storeLocations, storeMembers, stores } from '../db/schema.js';
import type { RouteOptions } from './stores.js';

const bearer = (header: string | undefined): string | undefined =>
  header?.replace(/^Bearer\s+/i, '').trim() || undefined;

/** The database CHECK on store_members.role allows exactly these three. */
const roleOf = (value: string): 'owner' | 'manager' | 'cashier' =>
  value === 'owner' ? 'owner' : value === 'manager' ? 'manager' : 'cashier';

/**
 * Who the caller is, and the stores they work at (FR-STO-9).
 *
 * The Cashier screen asks this before it knows a store id, so this route is
 * not nested under one. Only active memberships are listed; deactivated ones
 * are invisible to the screen.
 */
export const meRoutes: FastifyPluginAsyncZod<RouteOptions> = async (app, options) => {
  const { db, sessionResolver } = options;

  app.get(
    '/v1/me',
    {
      schema: {
        response: {
          200: meResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeStaffRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const staffRows = await db
        .select({
          id: staffUsers.id,
          email: staffUsers.email,
          name: staffUsers.name,
          isAdmin: staffUsers.isAdmin,
        })
        .from(staffUsers)
        .where(eq(staffUsers.id, auth.staffUserId))
        .limit(1);

      const staff = staffRows[0];
      if (!staff) {
        return reply
          .code(401)
          .send({ error: { code: 'INVALID_TOKEN', message: 'That access token is not valid' } });
      }

      const memberships = await db
        .select({
          storeId: storeMembers.storeId,
          storeName: stores.name,
          role: storeMembers.role,
          locationId: storeMembers.locationId,
          locationName: storeLocations.name,
          status: storeMembers.status,
        })
        .from(storeMembers)
        .innerJoin(stores, eq(stores.id, storeMembers.storeId))
        .leftJoin(storeLocations, eq(storeLocations.id, storeMembers.locationId))
        .where(and(eq(storeMembers.userId, auth.staffUserId), eq(storeMembers.status, 'active')))
        .orderBy(stores.name);

      return reply.send({
        staff,
        memberships: memberships.map((membership) => ({
          ...membership,
          role: roleOf(membership.role),
        })),
      });
    },
  );
};

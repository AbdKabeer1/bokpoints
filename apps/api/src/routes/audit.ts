import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  adminAuditQuerySchema,
  apiErrorSchema,
  auditQuerySchema,
  auditResponseSchema,
  storeIdParamsSchema,
} from '@bokpoints/shared';
import { authorizeAdminRequest, authorizeStoreRequest } from '../auth/authorize.js';
import type { SessionResolver } from '../auth/session.js';
import type { Database } from '../db/client.js';
import { auditLogEntries, staffUsers } from '../db/schema.js';

export interface AuditRouteOptions {
  db: Database;
  sessionResolver?: SessionResolver | undefined;
  rateLimit?: { max: number; timeWindow: string } | undefined;
}

const bearer = (header: string | undefined): string | undefined =>
  header?.replace(/^Bearer\s+/i, '').trim() || undefined;

/**
 * Reads the audit log (FR-AUD-1, FR-AUD-2). Reading only: the table is
 * append-only by database trigger, and nothing here can change an entry.
 *
 * Owners and managers see their own store; an admin sees the platform, with an
 * optional store filter. The actor's email is joined in so a line is readable
 * without another lookup.
 */
export const auditRoutes: FastifyPluginAsyncZod<AuditRouteOptions> = async (app, options) => {
  const { db, sessionResolver, rateLimit } = options;

  const selectEntries = (where: SQL | undefined) =>
    db
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
      .where(where)
      .orderBy(desc(auditLogEntries.createdAt), desc(auditLogEntries.id));

  app.get(
    '/v1/stores/:storeId/audit',
    {
      config: { rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' } },
      schema: {
        params: storeIdParamsSchema,
        querystring: auditQuerySchema,
        response: {
          200: auditResponseSchema,
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
        anyOf: ['audit.view'],
      });
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const rows = await selectEntries(
        and(
          eq(auditLogEntries.storeId, storeId),
          request.query.action === undefined
            ? undefined
            : eq(auditLogEntries.action, request.query.action),
        ),
      ).limit(request.query.limit);

      return reply.send({
        entries: rows.map((row) => ({
          ...row,
          createdAt: new Date(row.createdAt).toISOString(),
        })),
      });
    },
  );

  app.get(
    '/v1/admin/audit',
    {
      config: { rateLimit: rateLimit ?? { max: 120, timeWindow: '1 minute' } },
      schema: {
        querystring: adminAuditQuerySchema,
        response: {
          200: auditResponseSchema,
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

      const rows = await selectEntries(
        and(
          request.query.storeId === undefined
            ? undefined
            : eq(auditLogEntries.storeId, request.query.storeId),
          request.query.action === undefined
            ? undefined
            : eq(auditLogEntries.action, request.query.action),
        ),
      ).limit(request.query.limit);

      return reply.send({
        entries: rows.map((row) => ({
          ...row,
          createdAt: new Date(row.createdAt).toISOString(),
        })),
      });
    },
  );
};

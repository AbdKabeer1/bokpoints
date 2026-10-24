import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apiErrorSchema,
  campaignAudienceSchema,
  campaignCreateRequestSchema,
  campaignRowSchema,
  campaignsResponseSchema,
  storeIdParamsSchema,
} from '@bokpoints/shared';
import { authorizeStoreRequest } from '../auth/authorize.js';
import type { SessionResolver } from '../auth/session.js';
import type { Database } from '../db/client.js';
import {
  campaignAudience,
  createAndSendCampaign,
  listCampaigns,
} from '../db/campaigns.js';

export interface CampaignRouteOptions {
  db: Database;
  sessionResolver?: SessionResolver | undefined;
  rateLimit?: { max: number; timeWindow: string } | undefined;
}

const bearer = (header: string | undefined): string | undefined =>
  header?.replace(/^Bearer\s+/i, '').trim() || undefined;

const toBody = (row: {
  id: string;
  title: string;
  body: string;
  status: string;
  recipients: number;
  opened: number;
  createdAt: Date;
}) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() });

/**
 * In-app campaigns (D-148). A store writes one short message and Poket
 * delivers it to its consenting customers inside the app. There is no email
 * or SMS path: without a sender, offering the switches would be a lie.
 */
export const campaignRoutes: FastifyPluginAsyncZod<CampaignRouteOptions> = async (
  app,
  options,
) => {
  const { db, sessionResolver, rateLimit } = options;

  app.get(
    '/v1/stores/:storeId/campaigns/audience',
    {
      config: { rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: storeIdParamsSchema,
        response: {
          200: campaignAudienceSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeStoreRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        storeId: request.params.storeId,
        anyOf: ['campaigns.manage'],
      });
      if (!auth.ok) return reply.code(auth.status).send({ error: auth.error });

      return reply.send(await campaignAudience(db, request.params.storeId));
    },
  );

  app.get(
    '/v1/stores/:storeId/campaigns',
    {
      config: { rateLimit: rateLimit ?? { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: storeIdParamsSchema,
        response: {
          200: campaignsResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeStoreRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        storeId: request.params.storeId,
        anyOf: ['campaigns.manage'],
      });
      if (!auth.ok) return reply.code(auth.status).send({ error: auth.error });

      const rows = await listCampaigns(db, request.params.storeId);
      return reply.send({ campaigns: rows.map(toBody) });
    },
  );

  app.post(
    '/v1/stores/:storeId/campaigns',
    {
      // Sending is a human action with a customer-visible result: a low
      // ceiling keeps a stuck finger from flooding the inbox.
      config: { rateLimit: rateLimit ?? { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: storeIdParamsSchema,
        body: campaignCreateRequestSchema,
        response: {
          201: campaignRowSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = await authorizeStoreRequest(db, sessionResolver, {
        token: bearer(request.headers.authorization),
        storeId: request.params.storeId,
        anyOf: ['campaigns.manage'],
      });
      if (!auth.ok) return reply.code(auth.status).send({ error: auth.error });

      const campaign = await createAndSendCampaign(db, {
        storeId: request.params.storeId,
        staffUserId: auth.staffUserId,
        title: request.body.title,
        body: request.body.body,
      });

      return reply.code(201).send(toBody(campaign));
    },
  );
};

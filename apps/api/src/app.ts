import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { CustomerSessionResolver, SessionResolver } from './auth/session.js';
import type { Database } from './db/client.js';
import { createLogoStore, type LogoStore } from './db/logo-storage.js';
import { adminRoutes } from './routes/admin.js';
import { auditRoutes } from './routes/audit.js';
import { campaignRoutes } from './routes/campaigns.js';
import { customerRoutes } from './routes/customer.js';
import { meRoutes } from './routes/me.js';
import { staffRoutes } from './routes/staff.js';
import { storeCustomerRoutes } from './routes/store-customers.js';
import { storeRoutes } from './routes/stores.js';

export interface RateLimitOptions {
  max: number;
  timeWindow: string;
}

export interface BuildAppOptions {
  db?: Database;
  sessionResolver?: SessionResolver | undefined;
  /** Verifies customer tokens (D-111); separate because customers need no MFA. */
  customerResolver?: CustomerSessionResolver | undefined;
  /**
   * Browser origins allowed to call the API (D-112). Empty means no CORS:
   * browser clients then use a same-origin proxy, as the till's Vite dev
   * server does. Native apps are unaffected either way.
   */
  corsOrigins?: string[] | undefined;
  /** Overrides the Supabase-backed logo store (tests use a stub). */
  logoStore?: LogoStore | null | undefined;
  logger?: boolean;
  /** Overrides the rate limits. Used by the tests to keep them small. */
  rateLimit?: RateLimitOptions | undefined;
  /**
   * Whether the interactive API documentation is served. Off in production.
   */
  enableDocs?: boolean | undefined;
  /**
   * Passed to Fastify as `trustProxy`. On when the API runs behind a load
   * balancer or reverse proxy, so `request.ip` (and therefore the rate
   * limiter key) is the caller's address from `X-Forwarded-For` instead of
   * the proxy's, and each caller still gets its own bucket (D-095). Off
   * when the API is reached directly, so a forged header cannot defeat the
   * limiter.
   */
  trustProxy?: boolean | number | undefined;
}

/**
 * Builds the Fastify instance.
 *
 * The database and the session resolver are optional here so the health
 * check can be served without them; `server.ts` supplies the real ones at
 * runtime. Without a session resolver no protected route can be reached.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: options.trustProxy as unknown as boolean,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const enableDocs = options.enableDocs ?? true;

  // Security headers. The content security policy is relaxed only while the
  // interactive documentation is served, because that page needs inline
  // scripts.
  await app.register(helmet, enableDocs ? { contentSecurityPolicy: false } : {});

  // Only the named origins get browser access. `false` disables CORS
  // entirely, which is the safe default for a locally proxied app.
  await app.register(cors, {
    origin: options.corsOrigins ?? false,
    // PATCH is part of the customer profile; the default list omits it and a
    // browser preflight would then block onboarding (found in review).
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'],
  });

  // Rate limiting is applied per route, not globally: the scanning and
  // awarding endpoints need it, the health check does not (AGENT.md
  // section 8).
  await app.register(rateLimit, { global: false });

  // FR-API-3: the API is versioned and documented from the start. The
  // document is generated from the same Zod schemas that validate the
  // requests, so it cannot drift away from the code.
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'BOKPOINTS API',
        description:
          'Loyalty platform for small businesses. Every call is authenticated, scoped to one store and permission-checked.',
        version: '0.1.0',
      },
      servers: [{ url: '/' }],
    },
    transform: jsonSchemaTransform,
  });

  if (enableDocs) {
    await app.register(swaggerUi, { routePrefix: '/v1/docs' });
  }

  // One error shape for every failure, so a client never has to guess.
  app.setErrorHandler((error: unknown, request, reply) => {
    const status = statusCodeOf(error);
    if (status >= 400 && status < 500) {
      return reply.code(status).send({
        error: {
          code: errorCodeOf(error),
          message: error instanceof Error ? error.message : 'That request was not valid',
        },
      });
    }
    request.log.error(error);
    return reply.code(status).send({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
  });

  app.get('/v1/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    // Render sets this; it makes a deploy verifiable without dashboard access.
    commit: process.env['RENDER_GIT_COMMIT'] ?? 'local',
  }));

  app.get('/v1/ping', async () => ({ pong: true }));

  app.get('/v1/openapi.json', async () => app.swagger());

  if (options.db) {
    await app.register(storeRoutes, {
      db: options.db,
      sessionResolver: options.sessionResolver,
      rateLimit: options.rateLimit,
      logoStore:
        options.logoStore === undefined
          ? createLogoStore(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
          : options.logoStore,
    });
    await app.register(adminRoutes, {
      db: options.db,
      sessionResolver: options.sessionResolver,
      rateLimit: options.rateLimit,
    });
    await app.register(staffRoutes, {
      db: options.db,
      sessionResolver: options.sessionResolver,
      rateLimit: options.rateLimit,
    });
    await app.register(meRoutes, {
      db: options.db,
      sessionResolver: options.sessionResolver,
      rateLimit: options.rateLimit,
    });
    await app.register(customerRoutes, {
      db: options.db,
      customerResolver: options.customerResolver,
      rateLimit: options.rateLimit,
    });
    await app.register(storeCustomerRoutes, {
      db: options.db,
      sessionResolver: options.sessionResolver,
      rateLimit: options.rateLimit,
    });
    await app.register(auditRoutes, {
      db: options.db,
      sessionResolver: options.sessionResolver,
      rateLimit: options.rateLimit,
    });
    await app.register(campaignRoutes, {
      db: options.db,
      sessionResolver: options.sessionResolver,
      rateLimit: options.rateLimit,
    });
  }

  return app;
}

/** The HTTP status a Fastify or Zod error carries, if any. */
function statusCodeOf(error: unknown): number {
  const value = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof value === 'number' && value >= 400 && value <= 599 ? value : 500;
}

/** The machine-readable code a Fastify or Zod error carries, if any. */
function errorCodeOf(error: unknown): string {
  const value = (error as { code?: unknown } | null)?.code;
  return typeof value === 'string' && value.length > 0 ? value : 'VALIDATION_ERROR';
}

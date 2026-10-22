import { buildApp } from './app.js';
import { createDevCustomerResolver, createDevSessionResolver } from './auth/dev-session.js';
import type { CustomerSessionResolver, SessionResolver } from './auth/session.js';
import {
  createSupabaseCustomerResolver,
  createSupabaseSessionResolver,
} from './auth/supabase-session.js';
import { createDb, createPool } from './db/client.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const db = createDb(pool);

/**
 * Chooses how the API authenticates callers.
 *
 * With SUPABASE_URL set it verifies Supabase access tokens (D-100). Without
 * it, the opt-in development resolver can be used, where the bearer token is
 * a staff email address. That one can never run in production, and production
 * refuses to start without Supabase, so the API is never left half open.
 */
function resolveSessionResolver(): SessionResolver | undefined {
  if (env.SUPABASE_URL) {
    if (env.ALLOW_DEV_AUTH) {
      throw new Error('ALLOW_DEV_AUTH and SUPABASE_URL cannot both be set');
    }
    return createSupabaseSessionResolver({ db, supabaseUrl: env.SUPABASE_URL });
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('SUPABASE_URL is required in production');
  }
  if (!env.ALLOW_DEV_AUTH) return undefined;

  console.warn(
    'WARNING: the development session resolver is enabled. ' +
      'Bearer tokens are staff email addresses. Never do this in production.',
  );
  return createDevSessionResolver(db);
}

/**
 * The customer resolver mirrors the staff one: Supabase when configured, the
 * opt-in development resolver otherwise. It is a separate resolver because
 * customers sign in with an email one-time code and have no second factor.
 */
function resolveCustomerResolver(): CustomerSessionResolver | undefined {
  if (env.SUPABASE_URL) {
    return createSupabaseCustomerResolver({ db, supabaseUrl: env.SUPABASE_URL });
  }
  if (env.NODE_ENV === 'production') return undefined;
  if (!env.ALLOW_DEV_AUTH) return undefined;
  return createDevCustomerResolver();
}

const app = await buildApp({
  db,
  sessionResolver: resolveSessionResolver(),
  customerResolver: resolveCustomerResolver(),
  logger: true,
  rateLimit: { max: env.RATE_LIMIT_MAX, timeWindow: '1 minute' },
  // The interactive documentation is not served in production.
  enableDocs: env.NODE_ENV !== 'production',
  // Behind the load balancer the rate limiter must key on the caller, not
  // on the proxy (D-095).
  trustProxy: env.TRUST_PROXY,
});

app.addHook('onClose', async () => {
  await pool.end();
});

await app.listen({ port: env.PORT, host: env.HOST });

import { buildApp } from './app.js';
import { createDevSessionResolver } from './auth/dev-session.js';
import type { SessionResolver } from './auth/session.js';
import { createDb, createPool } from './db/client.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const db = createDb(pool);

/**
 * The Supabase resolver is build step 3. Until then the API can run with the
 * development resolver, where the bearer token is a staff email address.
 * It is off unless it is asked for, and it can never be on in production.
 */
function resolveSessionResolver(): SessionResolver | undefined {
  if (!env.ALLOW_DEV_AUTH) return undefined;
  if (env.NODE_ENV === 'production') {
    throw new Error('ALLOW_DEV_AUTH must not be enabled in production');
  }
  console.warn(
    'WARNING: the development session resolver is enabled. ' +
      'Bearer tokens are staff email addresses. Never do this in production.',
  );
  return createDevSessionResolver(db);
}

const app = await buildApp({
  db,
  sessionResolver: resolveSessionResolver(),
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

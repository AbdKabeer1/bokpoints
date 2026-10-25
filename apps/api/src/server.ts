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

// In production TRUST_PROXY must be set explicitly to avoid a forged
// X-Forwarded-For defeating the rate limiter.
if (env.NODE_ENV === 'production' && !process.env.TRUST_PROXY) {
  throw new Error('TRUST_PROXY must be set explicitly in production');
}

// The verified-email check (D-120) and the Auth Admin calls need the
// secret key. Without it the API would answer sign-ins with a silent
// "not verified" for everyone, so production refuses to start.
if (env.NODE_ENV === 'production' && !env.SUPABASE_SECRET_KEY) {
  throw new Error('SUPABASE_SECRET_KEY is required in production');
}

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

/**
 * Customer provisioning links an unlinked customer row by the token's email
 * (D-111). Supabase only proves that email when email confirmation is on, so
 * a project with confirmations disabled would reopen the takeover path. The
 * token carries no verified flag, so the API says this loudly at boot.
 */
async function warnIfEmailConfirmationIsOff(): Promise<void> {
  if (!env.SUPABASE_URL) return;
  try {
    const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/settings`, {
      headers: { apikey: process.env['SUPABASE_PUBLISHABLE_KEY'] ?? '' },
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return;
    const settings = (await response.json()) as { mailer_autoconfirm?: boolean };
    if (settings.mailer_autoconfirm === true) {
      console.warn(
        'WARNING: Supabase email confirmation is OFF. Customer sign-in links an ' +
          'existing customer row by verified email; turn Confirm email on in the ' +
          'Supabase dashboard.',
      );
    }
  } catch {
    // A courtesy check must never stop the server from booting.
  }
}

await warnIfEmailConfirmationIsOff();

const app = await buildApp({
  db,
  sessionResolver: resolveSessionResolver(),
  customerResolver: resolveCustomerResolver(),
  corsOrigins: (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== ''),
  logger: true,
  rateLimit: { max: env.RATE_LIMIT_MAX, timeWindow: '1 minute' },
  // The interactive documentation is not served in production.
  enableDocs: env.NODE_ENV !== 'production',
  // Behind the load balancer the rate limiter must key on the caller, not
  // on the proxy (D-095).
  trustProxy: env.TRUST_PROXY as any,
});

app.addHook('onClose', async () => {
  await pool.end();
});

await app.listen({ port: env.PORT, host: env.HOST });

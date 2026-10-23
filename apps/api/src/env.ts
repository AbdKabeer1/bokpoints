import { z } from 'zod';

/**
 * The process environment the API needs. Names only go in `.env.example`;
 * real values come from the host's secret store (AGENT.md section 8).
 */
export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * The Supabase project URL. When it is set the API verifies Supabase access
   * tokens (D-100). It is required in production. The API only ever needs the
   * URL; the keys stay with the apps and the admin scripts.
   */
  /**
   * Browser origins allowed to call the API, comma-separated (D-112). Empty
   * or absent means no cross-origin browser access.
   */
  CORS_ORIGINS: z.string().optional(),
  SUPABASE_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  /**
   * The Supabase secret key, used server-side only: the verified-email
   * check (D-120) and the Auth Admin calls. Required in production —
   * the server refuses to start without it (Way Forward 4.4).
   */
  SUPABASE_SECRET_KEY: z.string().optional(),
  /**
   * How many awards a single caller may make per minute. A busy till is
   * far below this; it is there to stop a runaway client (AGENT.md
   * section 8).
   */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  /**
   * On when the API runs behind a load balancer or reverse proxy (D-095),
   * so `request.ip` — and the rate limiter key — is the caller's address
   * from `X-Forwarded-For` rather than the proxy's. Off when the API is
   * reached directly: with it on, a caller could forge that header.
   */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /**
   * Enables the development session resolver, where the bearer token is a
   * staff email address. It must never be on in production: the server
   * would accept anybody who knows a staff email.
   */
  ALLOW_DEV_AUTH: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}

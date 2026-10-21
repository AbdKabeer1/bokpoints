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
   * Enables the development session resolver, where the bearer token is a
   * staff email address. It must never be on in production: the server
   * would accept anybody who knows a staff email.
   */
  /**
   * How many awards a single caller may make per minute. A busy till is
   * far below this; it is there to stop a runaway client (AGENT.md
   * section 8).
   */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  ALLOW_DEV_AUTH: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}

import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from './db/client.js';

export interface BuildAppOptions {
  db?: Database;
  logger?: boolean;
}

/**
 * Builds the Fastify instance.
 *
 * The database is optional here so the health check can be served without
 * one; `server.ts` supplies the real pool at runtime.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  app.get('/v1/health', async () => ({
    status: 'ok',
    version: '0.1.0',
  }));

  app.get('/v1/ping', async () => ({ pong: true }));

  return app;
}

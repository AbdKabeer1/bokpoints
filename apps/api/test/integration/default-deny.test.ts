import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import {
  createDevCustomerResolver,
  createDevSessionResolver,
} from '../../src/auth/dev-session.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { applyMigrations, truncateAll } from './setup.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

let pool: ReturnType<typeof createPool>;
let db: Database;

beforeAll(async () => {
  pool = createPool(DATABASE_URL);
  await applyMigrations(pool);
  db = createDb(pool);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

/**
 * C7: every route that is not deliberately public must refuse an
 * unauthenticated caller. This is deliberately a route walk, not a list of
 * the routes someone remembered to add.
 */
describe('default deny', () => {
  it('never serves a protected route to an unauthenticated caller', async () => {
    const app = await buildApp({
      db,
      logger: false,
      enableDocs: false,
      sessionResolver: createDevSessionResolver(db),
      customerResolver: createDevCustomerResolver(),
    });
    await app.ready();

    const tree = app.printRoutes({ commonPrefix: false });
    const routes = [...tree.matchAll(/^\s*[├└│─\s]*(\S+)\s+\(([^)]+)\)/gm)].map((match) => ({
      path: match[1] ?? '',
      methods: (match[2] ?? '')
        .split(',')
        .map((method) => method.trim())
        .filter((method) => method !== '' && method !== 'HEAD' && method !== 'OPTIONS'),
    }));

    expect(routes.length).toBeGreaterThan(20);

    const publicRoutes = new Set(['/v1/health', '/v1/ping']);

    for (const route of routes) {
      for (const method of route.methods) {
        const url = route.path.replace(/:[^/]+/g, randomUUID());
        const res = await app.inject({ method, url });
        if (publicRoutes.has(route.path)) {
          expect(res.statusCode).toBeLessThan(500);
          continue;
        }
        expect([200, 201]).not.toContain(res.statusCode);
      }
    }

    await app.close();
  });
});

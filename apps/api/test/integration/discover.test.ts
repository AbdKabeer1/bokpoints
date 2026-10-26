import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDevCustomerResolver } from '../../src/auth/dev-session.js';
import { createDb, createPool, type Database } from '../../src/db/client.js';
import { applyMigrations, truncateAll } from './setup.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_test';

let pool: ReturnType<typeof createPool>;
let db: Database;

const CUSTOMER = 'discover@test.dev';

async function inject(url: string, token: string) {
  const app = await buildApp({
    db,
    customerResolver: createDevCustomerResolver(),
    discover: async () => [
      {
        osmId: 'node/1',
        name: 'Cafe Test',
        category: 'Cafe',
        address: 'Testikatu 1',
        distanceKm: 0.3,
        latitude: 60.17,
        longitude: 24.94,
        website: null,
        phone: null,
        openingHours: null,
      },
    ],
  });
  const res = await app.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${token}` },
  });
  await app.close();
  return res;
}

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

describe('GET /v1/customer/discover', () => {
  it('returns nearby OSM places for a customer with coordinates', async () => {
    const me = await inject('/v1/customer/me', CUSTOMER);
    expect(me.statusCode).toBe(200);

    const res = await inject(
      '/v1/customer/discover?lat=60.17&lon=24.94&radiusKm=10',
      CUSTOMER,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json() as { places: Array<{ name: string }>; available: boolean; attribution: string };
    expect(body.places[0]?.name).toBe('Cafe Test');
    expect(body.available).toBe(true);
    expect(body.attribution).toContain('OpenStreetMap');
  });

  it('refuses a missing token', async () => {
    const res = await inject('/v1/customer/discover?lat=60.17&lon=24.94', '');
    expect(res.statusCode).toBe(401);
  });
});

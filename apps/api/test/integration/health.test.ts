import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';

describe('health endpoints', () => {
  it('GET /v1/health returns 200 with no DB access', async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    await app.close();
  });

  it('GET /v1/health/auth is not publicly accessible', async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/v1/health/auth' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /v1/health/db is not publicly accessible', async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/v1/health/db' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('no unauthenticated route leaks Supabase URL', async () => {
    const app = await buildApp({ logger: false });
    const routes = [
      '/v1/health',
      '/v1/ping',
    ];
    for (const route of routes) {
      const res = await app.inject({ method: 'GET', url: route });
      const text = JSON.stringify(res.json());
      expect(text).not.toMatch(/SUPABASE_URL/i);
      expect(text).not.toMatch(/supabase\.co/i);
    }
    await app.close();
  });
});

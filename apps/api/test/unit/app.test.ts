import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

describe('buildApp', () => {
  it('serves a health check', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
    await app.close();
  });

  it('serves a ping', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/ping' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pong: true });
    await app.close();
  });

  it('returns 404 for an unknown route', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/nope' });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

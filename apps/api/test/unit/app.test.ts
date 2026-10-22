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


  it('allows the configured web origins and no others', async () => {
    const app = await buildApp({ corsOrigins: ['http://localhost:8081'] });
    const allowed = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: 'http://localhost:8081' },
    });
    const other = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: 'http://evil.test' },
    });

    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('sends no CORS headers when no origin is configured', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: 'http://localhost:8081' },
    });

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('returns 404 for an unknown route', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/nope' });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

describe('API response caching', () => {
  it('prevents caching when a request carries an authorization header', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('does not force public health responses to no-store', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/v1/health' });

    expect(response.headers['cache-control']).toBeUndefined();
    await app.close();
  });
});

import { describe, it, expect } from 'vitest';
import { requestLocation } from '../../src/lib/location';

describe('requestLocation', () => {
  it('returns coordinates when permission is granted', async () => {
    const original = (globalThis.navigator as any).geolocation;
    (globalThis.navigator as any).geolocation = {
      getCurrentPosition: (ok: any) => ok({ coords: { latitude: 60.17, longitude: 24.94 } }),
    };
    const result = await requestLocation();
    expect(result).toEqual({ lat: 60.17, lon: 24.94 });
    (globalThis.navigator as any).geolocation = original;
  });

  it('resolves null when the customer refuses', async () => {
    const original = (globalThis.navigator as any).geolocation;
    (globalThis.navigator as any).geolocation = {
      getCurrentPosition: (_ok: any, fail: any) => fail(new Error('denied')),
    };
    const result = await requestLocation();
    expect(result).toBeNull();
    (globalThis.navigator as any).geolocation = original;
  });

  it('resolves null when geolocation is unavailable', async () => {
    const original = (globalThis.navigator as any).geolocation;
    delete (globalThis.navigator as any).geolocation;
    const result = await requestLocation();
    expect(result).toBeNull();
    (globalThis.navigator as any).geolocation = original;
  });
});

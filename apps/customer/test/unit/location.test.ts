import { afterEach, describe, it, expect } from 'vitest';
import { requestLocation } from '../../src/lib/location';

type PositionStub = {
  coords: { latitude: number; longitude: number };
};

type GeolocationStub = {
  getCurrentPosition: (
    success: (position: PositionStub) => void,
    error?: (reason: unknown) => void
  ) => void;
};

const originalGeolocation = Object.getOwnPropertyDescriptor(
  globalThis.navigator,
  'geolocation'
);

function installGeolocation(stub: GeolocationStub | undefined): void {
  if (stub === undefined) {
    Reflect.deleteProperty(globalThis.navigator, 'geolocation');
    return;
  }
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: stub,
  });
}

afterEach(() => {
  if (originalGeolocation === undefined) {
    Reflect.deleteProperty(globalThis.navigator, 'geolocation');
    return;
  }
  Object.defineProperty(globalThis.navigator, 'geolocation', originalGeolocation);
});

describe('requestLocation', () => {
  it('returns coordinates when permission is granted', async () => {
    installGeolocation({
      getCurrentPosition: (ok) => ok({ coords: { latitude: 60.17, longitude: 24.94 } }),
    });

    const result = await requestLocation();
    expect(result).toEqual({ lat: 60.17, lon: 24.94 });
  });

  it('resolves null when the customer refuses', async () => {
    installGeolocation({
      getCurrentPosition: (_ok, fail) => fail?.(new Error('denied')),
    });

    const result = await requestLocation();
    expect(result).toBeNull();
  });

  it('resolves null when geolocation is unavailable', async () => {
    installGeolocation(undefined);

    const result = await requestLocation();
    expect(result).toBeNull();
  });
});

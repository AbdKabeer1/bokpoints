import { describe, expect, it } from 'vitest';
import { mergePlaces } from '../../src/lib/nearby';
import type { DirectoryStore, NearbyPlace } from '../../src/lib/api';

const store: DirectoryStore = {
  storeId: 's1',
  name: 'Cafe Test',
  address: 'Testikatu 1',
  category: 'Cafe',
  brandColor: null,
  logoUrl: null,
  visited: true,
  balance: 10,
  visitCount: 2,
  distanceKm: 0.1,
};

const osm: NearbyPlace = {
  osmId: 'node/1',
  name: 'Cafe Test',
  category: 'Cafe',
  address: 'Testikatu 1',
  distanceKm: 0.1,
  latitude: 60.17,
  longitude: 24.94,
  website: 'https://example.test',
  phone: '+358 40 123 4567',
  openingHours: 'Mo-Fr 08:00-18:00',
};

describe('mergePlaces', () => {
  it('merges registered and unregistered places without duplicating names', () => {
    const merged = mergePlaces([store], [osm]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.registered).toBe(true);
    expect(merged[0]?.storeId).toBe('s1');
  });

  it('carries the registered store logo and colour into the merged row', () => {
    const withLogo = {
      ...store,
      logoUrl: 'https://example.test/logo.png',
      brandColor: '#112233',
    };
    const merged = mergePlaces([withLogo], []);
    expect(merged[0]).toMatchObject({
      name: 'Cafe Test',
      logoUrl: 'https://example.test/logo.png',
      brandColor: '#112233',
    });
  });

  it('sorts by distance and keeps unregistered places', () => {
    const merged = mergePlaces(
      [store],
      [{ ...osm, osmId: 'node/2', name: 'Far Shop', category: 'Shop', distanceKm: 4.2 }],
    );
    expect(merged.map((place) => place.name)).toEqual(['Cafe Test', 'Far Shop']);
    expect(merged[1]?.registered).toBe(false);
  });
});

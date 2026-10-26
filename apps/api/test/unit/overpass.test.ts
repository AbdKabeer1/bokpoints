import { describe, expect, it } from 'vitest';
import { discoverNearby } from '../../src/lib/overpass.js';

describe('discoverNearby', () => {
  it('maps named OSM places to categories and distance', async () => {
    const fakeFetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          elements: [
            {
              type: 'node',
              id: 1,
              lat: 60.17,
              lon: 24.94,
              tags: {
                name: 'Cafe Test',
                amenity: 'cafe',
                'addr:street': 'Testikatu',
                'addr:housenumber': '1',
              },
            },
            {
              type: 'node',
              id: 2,
              lat: 60.2,
              lon: 24.95,
              tags: { amenity: 'restaurant' },
            },
          ],
        }),
      }) as unknown as Response) as typeof fetch;

    const places = await discoverNearby(
      { lat: 60.168, lon: 24.942, radiusKm: 10 },
      fakeFetch,
    );

    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      name: 'Cafe Test',
      category: 'Cafe',
      address: 'Testikatu 1',
    });
    expect(places[0]?.distanceKm).toBeGreaterThan(0);
  });

  it('returns an empty list when Overpass fails', async () => {
    const fakeFetch = (async () => ({ ok: false }) as unknown as Response) as typeof fetch;
    expect(await discoverNearby({ lat: 60.17, lon: 24.94, radiusKm: 10 }, fakeFetch)).toEqual([]);
  });

  it('uses Geoapify street line and maps beauty categories', async () => {
    const previous = process.env.GEOAPIFY_API_KEY;
    process.env.GEOAPIFY_API_KEY = 'test-key';
    try {
      const fakeFetch = (async () =>
        ({
          ok: true,
          json: async () => ({
            features: [
              {
                properties: {
                  place_id: 'place-1',
                  name: 'Salon Test',
                  categories: ['service', 'service.beauty', 'service.beauty.hairdresser'],
                  address_line1: 'Salon Test',
                  address_line2: 'Testikatu 1, 00100 Helsinki, Finland',
                  formatted: 'Salon Test, Testikatu 1, 00100 Helsinki, Finland',
                  street: 'Testikatu',
                  housenumber: '1',
                  postcode: '00100',
                  city: 'Helsinki',
                  lat: 60.17,
                  lon: 24.94,
                },
              },
            ],
          }),
        }) as unknown as Response) as typeof fetch;

      const places = await discoverNearby({ lat: 60.168, lon: 24.942, radiusKm: 10 }, fakeFetch);
      expect(places[0]).toMatchObject({
        name: 'Salon Test',
        category: 'Barber',
        address: 'Testikatu 1, 00100 Helsinki, Finland',
      });
    } finally {
      if (previous === undefined) delete process.env.GEOAPIFY_API_KEY;
      else process.env.GEOAPIFY_API_KEY = previous;
    }
  });

  it('maps shop tags to a readable category', async () => {
    const fakeFetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          elements: [
            {
              type: 'way',
              id: 3,
              center: { lat: 60.17, lon: 24.94 },
              tags: { name: 'Test Bakery', shop: 'bakery' },
            },
          ],
        }),
      }) as unknown as Response) as typeof fetch;

    const places = await discoverNearby({ lat: 60.17, lon: 24.94, radiusKm: 10 }, fakeFetch);
    expect(places[0]).toMatchObject({ name: 'Test Bakery', category: 'Bakery' });
  });
});

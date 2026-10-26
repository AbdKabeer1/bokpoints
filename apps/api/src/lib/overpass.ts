export interface NearbyPlace {
  osmId: string;
  name: string;
  category: string;
  address: string | null;
  distanceKm: number;
  latitude: number;
  longitude: number;
  website: string | null;
  phone: string | null;
  openingHours: string | null;
}

interface OsmElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

let lastError: string | null = null;

/** The last discovery failure, for the API's diagnostic field. */
export const lastDiscoveryError = (): string | null => lastError;

const AMENITY_CATEGORIES: Record<string, string> = {
  restaurant: 'Restaurant',
  cafe: 'Cafe',
  bar: 'Bar',
  pub: 'Pub',
  fast_food: 'Fast food',
  pharmacy: 'Pharmacy',
  bank: 'Bank',
  cinema: 'Cinema',
  theatre: 'Theatre',
  nightclub: 'Nightclub',
  ice_cream: 'Ice cream',
  dentist: 'Dentist',
  doctors: 'Doctor',
  veterinary: 'Vet',
  fuel: 'Fuel',
};

const titleCase = (value: string): string =>
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

function categoryFor(tags: Record<string, string>): string | null {
  const amenity = tags.amenity;
  if (amenity && AMENITY_CATEGORIES[amenity]) return AMENITY_CATEGORIES[amenity];

  const shop = tags.shop;
  if (shop) {
    if (shop === 'yes') return 'Shop';
    return titleCase(shop);
  }

  if (tags.tourism === 'hotel') return 'Hotel';
  if (tags.leisure === 'fitness_centre') return 'Gym';
  if (tags.leisure === 'spa') return 'Spa';
  if (tags.leisure === 'sauna') return 'Sauna';

  return null;
}

function addressFor(tags: Record<string, string>): string | null {
  const street = tags['addr:street'];
  const number = tags['addr:housenumber'];
  if (street) return [street, number].filter(Boolean).join(' ');

  const city = tags['addr:city'];
  if (city) return city;

  return null;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Finds named businesses near a point using the public OpenStreetMap Overpass
 * API. Returns an empty list on any failure so the caller can fall back to the
 * OmaPointii directory without showing an error.
 */
export async function discoverNearby(
  input: { lat: number; lon: number; radiusKm: number },
  fetchImpl: typeof fetch = fetch,
): Promise<NearbyPlace[]> {
  const geoapifyKey = process.env.GEOAPIFY_API_KEY;
  if (geoapifyKey) {
    return discoverGeoapify(input, geoapifyKey, fetchImpl);
  }

  const radiusKm = Math.min(Math.max(input.radiusKm, 1), 20);
  const radiusM = Math.round(radiusKm * 1000);

  const query = `[out:json][timeout:10];
(
  nwr["name"]["amenity"~"^(restaurant|cafe|bar|pub|fast_food|pharmacy|bank|cinema|theatre|nightclub|ice_cream|dentist|doctors|veterinary|fuel)$"](around:${radiusM},${input.lat},${input.lon});
  nwr["name"]["shop"](around:${radiusM},${input.lat},${input.lon});
  nwr["name"]["tourism"="hotel"](around:${radiusM},${input.lat},${input.lon});
  nwr["name"]["leisure"~"^(fitness_centre|spa|sauna)$"](around:${radiusM},${input.lat},${input.lon});
);
out center 120;`;

  try {
    const response = await fetchImpl('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'OmaPointii-pilot/0.1',
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return [];

    const json = (await response.json()) as { elements?: OsmElement[] };
    const elements = Array.isArray(json.elements) ? json.elements : [];

    const places: NearbyPlace[] = [];
    const seen = new Set<string>();

    for (const element of elements) {
      const tags = element.tags ?? {};
      const name = tags.name?.trim();
      if (!name) continue;

      const lat = element.lat ?? element.center?.lat;
      const lon = element.lon ?? element.center?.lon;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;

      const category = categoryFor(tags);
      if (!category) continue;

      const distanceKm = haversineKm(input.lat, input.lon, lat, lon);
      const key = `${name.toLowerCase()}|${distanceKm.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      places.push({
        osmId: `${element.type ?? 'node'}/${element.id ?? 0}`,
        name,
        category,
        address: addressFor(tags),
        distanceKm: Number(distanceKm.toFixed(1)),
        latitude: lat,
        longitude: lon,
        website: tags.website ?? tags['contact:website'] ?? null,
        phone: tags.phone ?? tags['contact:phone'] ?? null,
        openingHours: tags.opening_hours ?? null,
      });
    }

    return places.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 120);
  } catch {
    return [];
  }
}

interface GeoapifyFeature {
  properties?: {
    place_id?: string;
    name?: string;
    categories?: string[];
    /** Geoapify puts the place name here, not the street. */
    address_line1?: string;
    /** The street, postcode and city. */
    address_line2?: string;
    formatted?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    website?: string;
    phone?: string;
    opening_hours?: string;
    lat?: number;
    lon?: number;
  };
}

/**
 * Geoapify caps one response and sorts it by distance, so in a dense city the
 * food category can fill the whole page. Beauty and body care get their own
 * query and their own slots, otherwise barbers and salons never surface.
 */
const GEOAPIFY_GROUPS = [
  {
    categories: [
      'catering.restaurant',
      'catering.cafe',
      'catering.bar',
      'catering.pub',
      'catering.fast_food',
      'catering.ice_cream',
      'commercial.supermarket',
      'commercial.food_and_drink.bakery',
      'commercial.shopping_mall',
      'healthcare.pharmacy',
      'entertainment.cinema',
      'entertainment.culture.theatre',
      'accommodation.hotel',
      'sport.fitness',
    ].join(','),
    limit: 120,
    slots: 120,
  },
  {
    categories: ['service.beauty', 'commercial.health_and_beauty'].join(','),
    limit: 80,
    slots: 50,
  },
] as const;

/**
 * Geoapify's `address_line1` is the place name and `address_line2` is the
 * street line. Prefer the street line; compose it when Geoapify omits it.
 */
function geoapifyAddress(props: NonNullable<GeoapifyFeature['properties']>): string | null {
  const line2 = props.address_line2?.trim();
  if (line2) return line2;

  const street = [props.street, props.housenumber]
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ');
  const locality = [props.postcode, props.city]
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ');
  const composed = [street, locality].filter((part) => part !== '').join(', ');
  if (composed !== '') return composed;

  const formatted = props.formatted?.trim();
  if (!formatted) return null;
  const name = props.name?.trim();
  if (name && formatted.startsWith(`${name}, `)) return formatted.slice(name.length + 2);
  return formatted;
}

function geoapifyCategory(categories: string[]): string | null {
  // Geoapify returns every level of the category hierarchy, and the order is
  // not guaranteed to put the most specific one first. Match the whole list.
  const has = (prefix: string) =>
    categories.some((category) => category === prefix || category.startsWith(`${prefix}.`));

  if (has('catering.restaurant')) return 'Restaurant';
  if (has('catering.cafe')) return 'Cafe';
  if (has('catering.bar')) return 'Bar';
  if (has('catering.pub')) return 'Pub';
  if (has('catering.fast_food')) return 'Fast food';
  if (has('catering.ice_cream')) return 'Ice cream';
  if (has('commercial.supermarket')) return 'Supermarket';
  if (has('commercial.food_and_drink.bakery')) return 'Bakery';
  if (has('commercial.shopping_mall')) return 'Shopping mall';
  if (has('healthcare.pharmacy')) return 'Pharmacy';
  if (has('entertainment.cinema')) return 'Cinema';
  if (has('entertainment.culture.theatre')) return 'Theatre';
  if (has('accommodation.hotel')) return 'Hotel';
  if (has('sport.fitness')) return 'Gym';
  if (has('service.beauty.hairdresser')) return 'Barber';
  if (has('service.beauty.tanning_salon')) return 'Tanning';
  if (has('service.beauty.tattoo')) return 'Tattoo';
  if (has('service.beauty.spa')) return 'Spa';
  if (has('service.beauty')) return 'Beauty';
  if (has('commercial.health_and_beauty.cosmetics')) return 'Cosmetics';
  if (has('commercial.health_and_beauty.pharmacy')) return 'Pharmacy';
  if (has('commercial.health_and_beauty')) return 'Body care';
  return null;
}

async function discoverGeoapify(
  input: { lat: number; lon: number; radiusKm: number },
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<NearbyPlace[]> {
  const radiusKm = Math.min(Math.max(input.radiusKm, 1), 20);
  const radiusM = Math.round(radiusKm * 1000);
  const filter = `circle:${input.lon},${input.lat},${radiusM}`;

  const results = await Promise.all(
    GEOAPIFY_GROUPS.map(async (group) => {
      const url = new URL('https://api.geoapify.com/v2/places');
      url.searchParams.set('categories', group.categories);
      url.searchParams.set('filter', filter);
      url.searchParams.set('limit', String(group.limit));
      url.searchParams.set('apiKey', apiKey);

      try {
        const response = await fetchImpl(url.toString(), {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          return {
            places: [] as NearbyPlace[],
            error: `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
          };
        }

        const json = (await response.json()) as { features?: GeoapifyFeature[] };
        const features = Array.isArray(json.features) ? json.features : [];
        return { places: geoapifyPlaces(features, input), error: null };
      } catch (error) {
        return {
          places: [] as NearbyPlace[],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  const errors = results
    .map((result) => result.error)
    .filter((error): error is string => error !== null);

  // Each group contributes its own slots before the whole list is sorted, so a
  // dense category cannot evict a sparse one.
  const byId = new Map<string, NearbyPlace>();
  results.forEach((result, index) => {
    const slots = GEOAPIFY_GROUPS[index]?.slots ?? 0;
    for (const place of result.places.slice(0, slots)) {
      if (!byId.has(place.osmId)) byId.set(place.osmId, place);
    }
  });

  const places = Array.from(byId.values()).sort((a, b) => a.distanceKm - b.distanceKm);
  lastError = places.length === 0 ? (errors[0] ?? 'no nearby places returned') : (errors[0] ?? null);
  return places;
}

function geoapifyPlaces(
  features: GeoapifyFeature[],
  input: { lat: number; lon: number },
): NearbyPlace[] {
  const places: NearbyPlace[] = [];
  for (const feature of features) {
    const props = feature.properties;
    if (props === undefined) continue;
    const name = props.name?.trim();
    const lat = props.lat;
    const lon = props.lon;
    if (!name || typeof lat !== 'number' || typeof lon !== 'number') continue;

    const category = geoapifyCategory(props.categories ?? []);
    if (category === null) continue;

    places.push({
      osmId: props.place_id ?? `${lat},${lon}`,
      name,
      category,
      address: geoapifyAddress(props),
      distanceKm: Number(haversineKm(input.lat, input.lon, lat, lon).toFixed(1)),
      latitude: lat,
      longitude: lon,
      website: props.website ?? null,
      phone: props.phone ?? null,
      openingHours: props.opening_hours ?? null,
    });
  }
  return places.sort((a, b) => a.distanceKm - b.distanceKm);
}

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
  nwr["name"]["leisure"="fitness_centre"](around:${radiusM},${input.lat},${input.lon});
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
    address_line1?: string;
    address_line2?: string;
    website?: string;
    phone?: string;
    opening_hours?: string;
    lat?: number;
    lon?: number;
  };
}

const GEOAPIFY_CATEGORIES = [
  'catering.restaurant',
  'catering.cafe',
  'catering.bar',
  'catering.pub',
  'catering.fast_food',
  'catering.ice_cream',
  'commercial.supermarket',
  'commercial.bakery',
  'commercial.shopping_mall',
  'healthcare.pharmacy',
  'entertainment.cinema',
  'entertainment.theatre',
  'tourism.hotel',
  'sport.fitness',
].join(',');

function geoapifyCategory(categories: string[]): string | null {
  const first = categories[0] ?? '';
  if (first.startsWith('catering.restaurant')) return 'Restaurant';
  if (first.startsWith('catering.cafe')) return 'Cafe';
  if (first.startsWith('catering.bar')) return 'Bar';
  if (first.startsWith('catering.pub')) return 'Pub';
  if (first.startsWith('catering.fast_food')) return 'Fast food';
  if (first.startsWith('catering.ice_cream')) return 'Ice cream';
  if (first.startsWith('commercial.supermarket')) return 'Supermarket';
  if (first.startsWith('commercial.bakery')) return 'Bakery';
  if (first.startsWith('commercial.shopping_mall')) return 'Shopping mall';
  if (first.startsWith('commercial.shop')) return 'Shop';
  if (first.startsWith('healthcare.pharmacy')) return 'Pharmacy';
  if (first.startsWith('entertainment.cinema')) return 'Cinema';
  if (first.startsWith('entertainment.theatre')) return 'Theatre';
  if (first.startsWith('tourism.hotel')) return 'Hotel';
  if (first.startsWith('sport.fitness')) return 'Gym';
  return null;
}

async function discoverGeoapify(
  input: { lat: number; lon: number; radiusKm: number },
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<NearbyPlace[]> {
  const radiusKm = Math.min(Math.max(input.radiusKm, 1), 20);
  const radiusM = Math.round(radiusKm * 1000);

  const url = new URL('https://api.geoapify.com/v2/places');
  url.searchParams.set('categories', GEOAPIFY_CATEGORIES);
  url.searchParams.set('filter', `circle:${input.lon},${input.lat},${radiusM}`);
  url.searchParams.set('limit', '120');
  url.searchParams.set('apiKey', apiKey);

  try {
    const response = await fetchImpl(url.toString(), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`;
      return [];
    }

    const json = (await response.json()) as { features?: GeoapifyFeature[] };
    const features = Array.isArray(json.features) ? json.features : [];

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
        address: props.address_line1 ?? props.address_line2 ?? null,
        distanceKm: Number(haversineKm(input.lat, input.lon, lat, lon).toFixed(1)),
        latitude: lat,
        longitude: lon,
        website: props.website ?? null,
        phone: props.phone ?? null,
        openingHours: props.opening_hours ?? null,
      });
    }

    lastError = null;
    return places.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 120);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return [];
  }
}

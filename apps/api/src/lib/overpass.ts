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
  input: { lat: number; lon: number; radiusKm: number; q?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<NearbyPlace[]> {
  const geoapifyKey = process.env.GEOAPIFY_API_KEY;
  const q = input.q?.trim();
  if (geoapifyKey) {
    return q !== undefined && q !== ''
      ? discoverGeoapifySearch({ ...input, q }, geoapifyKey, fetchImpl)
      : discoverGeoapify(input, geoapifyKey, fetchImpl);
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

    const found = places.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 120);
    return q === undefined || q === ''
      ? found
      : found.filter((place) => place.name.toLowerCase().includes(q.toLowerCase()));
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
 * Top-level business categories. Querying the roots keeps the directory open to
 * every kind of business instead of a hand-picked list; the specific labels in
 * `geoapifyCategory` only make the common ones read better.
 */
const BUSINESS_ROOTS = [
  'catering',
  'commercial',
  'service',
  'healthcare',
  'entertainment',
  'sport',
  'tourism',
  'accommodation',
  'education',
  'office',
  'leisure',
] as const;

/**
 * Geoapify only honours a few categories per request; a long list silently
 * drops the earlier ones (which is why a roots-only query returned statues
 * instead of restaurants). Keep every request to a handful of roots, and give
 * hair and beauty their own queries so they cannot be crowded out.
 */
const GEOAPIFY_GROUPS = [
  { categories: 'catering', limit: 120, slots: 50, diversify: true },
  { categories: 'commercial,service', limit: 150, slots: 60, diversify: true },
  {
    categories: 'healthcare,entertainment,sport,accommodation',
    limit: 150,
    slots: 60,
    diversify: true,
  },
  { categories: 'service.beauty.hairdresser', limit: 60, slots: 25, diversify: false },
  {
    categories: 'service.beauty,commercial.health_and_beauty',
    limit: 80,
    slots: 25,
    diversify: false,
  },
] as const;

const MAX_PER_CATEGORY = 18;

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
  // Geoapify files plain shop=beauty salons under its spa category, so "Spa"
  // would mislabel most nail and beauty salons in the list.
  if (has('service.beauty.spa')) return 'Beauty';
  if (has('service.beauty')) return 'Beauty';
  if (has('commercial.health_and_beauty.cosmetics')) return 'Cosmetics';
  if (has('commercial.health_and_beauty.pharmacy')) return 'Pharmacy';
  if (has('commercial.health_and_beauty')) return 'Body care';

  // Anything else that is a real business category still gets a readable label
  // instead of being dropped: "commercial.clothing" -> "Clothing".
  const specific = categories
    .filter((category) =>
      BUSINESS_ROOTS.some((root) => category === root || category.startsWith(`${root}.`)),
    )
    .sort((a, b) => b.split('.').length - a.split('.').length);
  const parts = specific[0]?.split('.');
  const label = parts?.[parts.length - 1];
  return label === undefined ? null : titleCase(label);
}

type GeoapifyResult = { places: NearbyPlace[]; error: string | null };

async function fetchGeoapifyPlaces(
  url: URL,
  fetchImpl: typeof fetch,
  input: { lat: number; lon: number },
): Promise<GeoapifyResult> {
  try {
    const response = await fetchImpl(url.toString(), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return {
        places: [],
        error: `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
      };
    }

    const json = (await response.json()) as { features?: GeoapifyFeature[] };
    const features = Array.isArray(json.features) ? json.features : [];
    return { places: geoapifyPlaces(features, input), error: null };
  } catch (error) {
    return { places: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** Keeps one dense category (restaurants) from using every slot. */
function capPerCategory(places: NearbyPlace[], cap: number): NearbyPlace[] {
  const counts = new Map<string, number>();
  return places.filter((place) => {
    const count = counts.get(place.category) ?? 0;
    if (count >= cap) return false;
    counts.set(place.category, count + 1);
    return true;
  });
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
    GEOAPIFY_GROUPS.map((group) => {
      const url = new URL('https://api.geoapify.com/v2/places');
      url.searchParams.set('categories', group.categories);
      url.searchParams.set('filter', filter);
      url.searchParams.set('limit', String(group.limit));
      url.searchParams.set('apiKey', apiKey);
      return fetchGeoapifyPlaces(url, fetchImpl, input);
    }),
  );

  const errors = results
    .map((result) => result.error)
    .filter((error): error is string => error !== null);

  // Each group contributes its own slots before the whole list is sorted, so a
  // dense category cannot evict a sparse one.
  const byId = new Map<string, NearbyPlace>();
  results.forEach((result, index) => {
    const group = GEOAPIFY_GROUPS[index];
    if (group === undefined) return;
    const list = group.diversify
      ? capPerCategory(result.places, MAX_PER_CATEGORY)
      : result.places;
    for (const place of list.slice(0, group.slots)) {
      if (!byId.has(place.osmId)) byId.set(place.osmId, place);
    }
  });

  const places = Array.from(byId.values()).sort((a, b) => a.distanceKm - b.distanceKm);
  lastError = places.length === 0 ? (errors[0] ?? 'no nearby places returned') : (errors[0] ?? null);
  return places;
}

/** Look up a business by name anywhere inside the radius. */
async function discoverGeoapifySearch(
  input: { lat: number; lon: number; radiusKm: number; q: string },
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<NearbyPlace[]> {
  const radiusKm = Math.min(Math.max(input.radiusKm, 1), 20);
  const filter = `circle:${input.lon},${input.lat},${Math.round(radiusKm * 1000)}`;

  // Geoapify rejects a name-only query, so search the same small category
  // groups as the list and merge the matches.
  const results = await Promise.all(
    GEOAPIFY_GROUPS.map((group) => {
      const url = new URL('https://api.geoapify.com/v2/places');
      url.searchParams.set('categories', group.categories);
      url.searchParams.set('name', input.q);
      url.searchParams.set('filter', filter);
      url.searchParams.set('limit', '60');
      url.searchParams.set('apiKey', apiKey);
      return fetchGeoapifyPlaces(url, fetchImpl, input);
    }),
  );

  const errors = results
    .map((result) => result.error)
    .filter((error): error is string => error !== null);

  const byId = new Map<string, NearbyPlace>();
  for (const result of results) {
    for (const place of result.places) {
      if (!byId.has(place.osmId)) byId.set(place.osmId, place);
    }
  }

  const places = Array.from(byId.values())
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 120);
  lastError = places.length === 0 ? (errors[0] ?? 'no places matched that search') : (errors[0] ?? null);
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

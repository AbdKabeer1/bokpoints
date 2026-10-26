export async function geocodeAddress(address: string): Promise<{ latitude: number; longitude: number } | null> {
  if (!address || !address.trim()) return null;

  const enabled = process.env.GEOCODE_ENABLED !== 'false';
  if (!enabled) return null;

  // Deterministic fallback for tests / CI
  if (process.env.NODE_ENV === 'test') {
    // Return Helsinki centre for any address in the test suite
    return { latitude: 60.1699, longitude: 24.9384 };
  }

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', address.trim());
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'OmaPointii-pilot/0.1',
        'Accept': 'application/json',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;

    const lat = Number(data[0].lat);
    const lon = Number(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return { latitude: lat, longitude: lon };
  } catch {
    return null;
  }
}

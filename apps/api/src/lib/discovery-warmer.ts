import { discoverNearby } from './overpass.js';
import { discoverCache } from './discover-cache.js';

/** Helsinki city centre — the pilot's first cluster. */
const HELSINKI = { lat: 60.168, lon: 24.942, radiusKm: 10 };

/** Warms the discovery cache every 10 minutes so the first customer load
 *  hits a cached answer instead of a 6–9 s Geoapify round trip.
 *
 *  Five Geoapify category groups per call × six calls per hour = 30 requests/
 *  hour = 720/day, well under the free tier's 3,000/day.
 */
export function startDiscoveryWarmer(): void {
  const key = `${HELSINKI.lat.toFixed(3)},${HELSINKI.lon.toFixed(3)},${HELSINKI.radiusKm},`;

  const warm = async (): Promise<void> => {
    try {
      const places = await discoverNearby(HELSINKI);
      discoverCache.set(key, { places, at: Date.now() });
    } catch {
      // Silent fail; the next interval retries. The route falls back to an
      // uncached fetch if the cache is empty.
    }
  };

  // Warm immediately on startup, then on a timer.
  void warm();
  setInterval(warm, WARMER_INTERVAL_MS);
}

const WARMER_INTERVAL_MS = 10 * 60 * 1000;

import type { NearbyPlace } from './overpass.js';

/** Shared discovery cache used by the route and the warmer. */

export interface CachedDiscovery {
  places: NearbyPlace[];
  at: number;
}

export const discoverCache = new Map<string, CachedDiscovery>();

/** Results are cached five minutes per rounded coordinate + radius. */
export const DISCOVER_TTL_MS = 5 * 60 * 1000;

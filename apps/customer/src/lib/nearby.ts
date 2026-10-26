import type { DirectoryStore, NearbyPlace } from './api';

export interface MergedPlace {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  distanceKm: number | null;
  registered: boolean;
  storeId: string | null;
  visitCount: number;
  /** The owner's uploaded logo and brand colour; null for OSM-only places. */
  logoUrl: string | null;
  brandColor: string | null;
  website: string | null;
  phone: string | null;
  openingHours: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * One distance-sorted list: OmaPointii stores keep their identity and win any
 * name collision with an OpenStreetMap place; the OSM contact details enrich
 * the registered row instead of duplicating it.
 */
export function mergePlaces(
  directory: DirectoryStore[],
  nearby: NearbyPlace[],
): MergedPlace[] {
  const byName = new Map<string, MergedPlace>();

  for (const store of directory) {
    const key = store.name.trim().toLowerCase();
    byName.set(key, {
      id: `store:${store.storeId}`,
      name: store.name,
      category: store.category ?? null,
      address: store.address,
      distanceKm: store.distanceKm ?? null,
      registered: true,
      storeId: store.storeId,
      visitCount: store.visitCount,
      logoUrl: store.logoUrl,
      brandColor: store.brandColor,
      website: null,
      phone: null,
      openingHours: null,
      latitude: null,
      longitude: null,
    });
  }

  for (const place of nearby) {
    const key = place.name.trim().toLowerCase();
    const existing = byName.get(key);
    if (existing !== undefined) {
      existing.website = existing.website ?? place.website;
      existing.phone = existing.phone ?? place.phone;
      existing.openingHours = existing.openingHours ?? place.openingHours;
      existing.latitude = existing.latitude ?? place.latitude;
      existing.longitude = existing.longitude ?? place.longitude;
      continue;
    }
    byName.set(key, {
      id: `osm:${place.osmId}`,
      name: place.name,
      category: place.category,
      address: place.address,
      distanceKm: place.distanceKm,
      registered: false,
      storeId: null,
      visitCount: 0,
      logoUrl: null,
      brandColor: null,
      website: place.website,
      phone: place.phone,
      openingHours: place.openingHours,
      latitude: place.latitude,
      longitude: place.longitude,
    });
  }

  return Array.from(byName.values()).sort((a, b) => {
    if (a.distanceKm == null && b.distanceKm == null) return a.name.localeCompare(b.name);
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    return a.name.localeCompare(b.name);
  });
}

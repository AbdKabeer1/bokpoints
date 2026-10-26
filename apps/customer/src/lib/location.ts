export type Coordinates = { lat: number; lon: number };

export type LocationAvailability = 'granted' | 'prompt' | 'denied' | 'unsupported';

export async function locationAvailability(): Promise<LocationAvailability> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return 'unsupported';
  }
  try {
    if ('permissions' in navigator) {
      const status = await navigator.permissions.query({
        name: 'geolocation' as PermissionName,
      });
      if (status.state === 'granted' || status.state === 'prompt' || status.state === 'denied') {
        return status.state;
      }
    }
  } catch {
    // Safari may not support querying geolocation permission; assume prompt.
  }
  return 'prompt';
}

export async function requestLocation(): Promise<Coordinates | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return null;
  }

  return new Promise<Coordinates | null>((resolve) => {
    let settled = false;
    const finish = (value: Coordinates | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    // A browser can leave the callback pending indefinitely; do not let the
    // Stores tab sit on "Finding your location…" forever.
    const timer = setTimeout(() => finish(null), 12_000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        finish({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        });
      },
      () => {
        clearTimeout(timer);
        finish(null);
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 300_000,
      }
    );
  });
}

export type Coordinates = { lat: number; lon: number };

export async function requestLocation(): Promise<Coordinates | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return null;
  }

  return new Promise<Coordinates | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        });
      },
      () => {
        resolve(null);
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 300_000,
      }
    );
  });
}

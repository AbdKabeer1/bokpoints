import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  getLeads,
  getNearbyBusinesses,
  inviteLead,
} from '../api';
import { ownerMessage } from '../errors';

interface Place {
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

interface Lead {
  leadId: string;
  osmId: string;
  name: string;
  status: string;
}

const loc = (): Promise<{ lat: number; lon: number } | null> =>
  new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  });

export function NearbyScreen({ token, storeId }: { token: string; storeId: string }) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);

  const loadLeads = useCallback(async () => {
    try {
      const result = await getLeads(token, storeId);
      setLeads(result.leads);
    } catch {
      // The list of invites is secondary; the nearby search still works.
    }
  }, [token, storeId]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  const findNearby = async () => {
    setLocating(true);
    setError(null);
    setFlash(null);
    const coords = await loc();
    if (coords === null) {
      setError('We could not read your location. Allow location access and try again.');
      setLocating(false);
      return;
    }
    try {
      const result = await getNearbyBusinesses(token, storeId, coords.lat, coords.lon, 10);
      setPlaces(result.places);
      if (result.places.length === 0) {
        setFlash('No businesses found within 10 km. Try again from a different spot.');
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError ? ownerMessage(caught.code) : 'Could not load nearby businesses.',
      );
    } finally {
      setLocating(false);
    }
  };

  const invite = async (place: Place) => {
    setInviting(place.osmId);
    setError(null);
    setFlash(null);
    try {
      const lead = await inviteLead(token, storeId, {
        osmId: place.osmId,
        name: place.name,
        category: place.category,
        address: place.address,
        website: place.website,
        phone: place.phone,
        openingHours: place.openingHours,
        latitude: place.latitude,
        longitude: place.longitude,
        distanceKm: place.distanceKm,
      });
      setLeads((current) => [
        { leadId: lead.leadId, osmId: lead.osmId, name: lead.name, status: lead.status },
        ...current.filter((entry) => entry.osmId !== lead.osmId),
      ]);
      setFlash(`Invited ${place.name}. The OmaPointii team can follow up.`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? ownerMessage(caught.code) : 'Could not save the invite.',
      );
    } finally {
      setInviting(null);
    }
  };

  const invited = new Set(leads.map((lead) => lead.osmId));

  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Nearby businesses</h1>
          <p className="sub">
            Discover restaurants, cafés, shops and more around your store, and invite them to
            OmaPointii.
          </p>
        </div>
        <button className="primary" type="button" onClick={() => void findNearby()} disabled={locating}>
          {locating ? 'Finding…' : 'Use my location'}
        </button>
      </div>

      {error !== null && <p className="error">{error}</p>}
      {flash !== null && <p className="flash">{flash}</p>}

      {places.length === 0 ? (
        <div className="panel">
          <p className="muted">
            Allow location access to see businesses within 10 km. Nothing is shared with them
            until you invite them.
          </p>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          {places.map((place) => {
            const alreadyInvited = invited.has(place.osmId);
            const open = openId === place.osmId;
            return (
              <div
                key={place.osmId}
                style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid var(--line, #e5e1d8)',
                }}
              >
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : place.osmId)}
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      background: 'none',
                      border: 0,
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    <strong style={{ display: 'block' }}>{place.name}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {[place.category, place.address, `${place.distanceKm} km`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </button>
                  <button
                    className={alreadyInvited ? 'ghost' : 'primary'}
                    type="button"
                    disabled={alreadyInvited || inviting === place.osmId}
                    onClick={() => void invite(place)}
                  >
                    {alreadyInvited
                      ? 'Invited'
                      : inviting === place.osmId
                        ? 'Inviting…'
                        : 'Invite'}
                  </button>
                </div>

                {open && (
                  <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.7 }}>
                    {place.website !== null && (
                      <p style={{ margin: 0 }}>
                        Website:{' '}
                        <a href={place.website} target="_blank" rel="noreferrer">
                          {place.website}
                        </a>
                      </p>
                    )}
                    {place.phone !== null && (
                      <p style={{ margin: 0 }}>
                        Phone: <a href={`tel:${place.phone.replace(/\s+/g, '')}`}>{place.phone}</a>
                      </p>
                    )}
                    {place.openingHours !== null && (
                      <p style={{ margin: 0 }}>Open: {place.openingHours}</p>
                    )}
                    {place.website === null && place.phone === null && place.openingHours === null && (
                      <p className="muted" style={{ margin: 0 }}>
                        No public contact details in OpenStreetMap.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {leads.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, marginTop: 24 }}>Invited businesses</h2>
          <div className="panel" style={{ padding: 0 }}>
            {leads.map((lead) => (
              <div
                key={lead.leadId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--line, #e5e1d8)',
                }}
              >
                <span>{lead.name}</span>
                <span className="muted">{lead.status}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>
        Nearby data © OpenStreetMap contributors.
      </p>
    </section>
  );
}

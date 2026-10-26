import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  getProfile,
  removeLogo,
  updateProfile,
  uploadLogo,
  type Profile as ProfileData,
} from '../api';
import { ownerMessage } from '../errors';

/** What the customer's app paints this store's page with (D-139). */
export function ProfileScreen({ token, storeId }: { token: string; storeId: string }) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [category, setCategory] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [brandColor, setBrandColor] = useState('#0b7a4b');
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const got = await getProfile(token, storeId);
      setProfile(got);
      setName(got.name);
      setAddress(got.address ?? '');
      setCategory(got.category ?? '');
      setContactName(got.contactName ?? '');
      setContactEmail(got.contactEmail ?? '');
      setBrandColor(got.brandColor ?? '#0b7a4b');
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'The API is not reachable.');
    }
  }, [token, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleLogo = async (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Use a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Use an image under 2 MB.');
      return;
    }
    setLogoBusy(true);
    setError(null);
    setFlash(null);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const saved = await uploadLogo(token, storeId, {
        contentType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
        data,
      });
      setProfile(saved);
      setFlash('Logo updated. Customers see it on your store page.');
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'Could not upload it.');
    } finally {
      setLogoBusy(false);
    }
  };

  const handleRemoveLogo = async () => {
    setLogoBusy(true);
    setError(null);
    setFlash(null);
    try {
      setProfile(await removeLogo(token, storeId));
      setFlash('Logo removed. Customers see your initials again.');
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'Could not remove it.');
    } finally {
      setLogoBusy(false);
    }
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const saved = await updateProfile(token, storeId, {
        name: name.trim(),
        address: address.trim() === '' ? null : address.trim(),
        category: category.trim() === '' ? null : category.trim(),
        contactName: contactName.trim() === '' ? null : contactName.trim(),
        contactEmail: contactEmail.trim() === '' ? null : contactEmail.trim(),
        brandColor,
      });
      setProfile(saved);
      setFlash('Saved. The customer app shows this store with your colour.');
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'Could not save it.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Store profile</h1>
          <p className="sub">What customers see in their OmaPointii app</p>
        </div>
      </div>

      {error !== null && <p className="error">{error}</p>}
      {flash !== null && <p className="flash">{flash}</p>}

      {profile !== null && (
        <div className="panel" style={{ maxWidth: 760 }}>
          <div className="logo-row">
            <div className="logo-box" style={{ backgroundColor: brandColor }}>
              {profile.logoUrl === null ? (
                <span>
                  {(name || 'S')
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0]?.toUpperCase() ?? '')
                    .join('')}
                </span>
              ) : (
                <img src={profile.logoUrl} alt={`${name} logo`} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>Store logo</strong>
              <p className="muted" style={{ fontSize: 12, margin: '3px 0 10px' }}>
                PNG, JPEG or WebP, up to 2 MB. Customers see it on their store card and page.
              </p>
              <div className="actions">
                <button
                  className="ghost small"
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={logoBusy}
                >
                  {logoBusy ? 'Uploading…' : profile.logoUrl === null ? 'Upload logo' : 'Replace logo'}
                </button>
                {profile.logoUrl !== null && (
                  <button
                    className="ghost small danger"
                    type="button"
                    onClick={() => void handleRemoveLogo()}
                    disabled={logoBusy}
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) void handleLogo(file);
                  event.target.value = '';
                }}
              />
            </div>
          </div>

          <div className="storepreview">
            <span className="storepreview-swatch" style={{ backgroundColor: brandColor }} aria-hidden="true">
              {profile.logoUrl !== null && <img src={profile.logoUrl} alt="" />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{name || 'Your store'}</strong>
              <span>{address || 'Add an address so customers can find you'}</span>
            </div>
            <span className="pill info">Store page</span>
          </div>

          <form className="form" onSubmit={(event) => void handleSave(event)}>
            <label htmlFor="profile-name">Store name</label>
            <input
              id="profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />

            <label htmlFor="profile-address">Address</label>
            <input
              id="profile-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Mannerheimintie 1, Helsinki"
              disabled={busy}
            />

            <label htmlFor="profile-category">Category</label>
            <input
              id="profile-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="Restaurant, cafe, shop…"
              disabled={busy}
            />

            <div className="formgrid">
              <div>
                <label htmlFor="profile-contact">Contact person</label>
                <input
                  id="profile-contact"
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  disabled={busy}
                />
              </div>
              <div>
                <label htmlFor="profile-email">Contact email</label>
                <input
                  id="profile-email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  disabled={busy}
                />
              </div>
            </div>

            <label htmlFor="profile-colour">Brand colour</label>
            <div className="colourrow">
              <input
                id="profile-colour"
                type="color"
                value={brandColor}
                onChange={(event) => setBrandColor(event.target.value)}
                disabled={busy}
              />
              <span className="muted">{brandColor}</span>
            </div>

            <button className="primary" type="submit" disabled={busy || name.trim() === ''}>
              {busy ? 'Saving…' : 'Save profile'}
            </button>
            <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>
              The logo image arrives with image storage; the colour and name already reach the
              customer app.
            </p>
          </form>
        </div>
      )}
    </section>
  );
}

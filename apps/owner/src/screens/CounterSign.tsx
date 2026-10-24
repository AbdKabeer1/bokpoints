import { useCallback, useEffect, useState } from 'react';
import { ApiError, getProfile } from '../api';
import { ownerMessage } from '../errors';

/**
 * The counter sign (the table tent by the till): the store's name and
 * colour, printable straight from the browser. The QR encodes the store's
 * identity for the customer app's store finder, which arrives with the
 * app's next step — until then the sign carries the name and the promise.
 */
export function CounterSignScreen({ token, storeId }: { token: string; storeId: string }) {
  const [name, setName] = useState<string | null>(null);
  const [brandColor, setBrandColor] = useState('#0b7a4b');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const profile = await getProfile(token, storeId);
      setName(profile.name);
      if (profile.brandColor !== null) setBrandColor(profile.brandColor);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'The API is not reachable.');
    }
  }, [token, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <div className="pagehead">
        <h1>Counter sign</h1>
        <button className="ghost" type="button" onClick={() => window.print()}>
          Print
        </button>
      </div>

      {error !== null && <p className="error">{error}</p>}

      {name !== null && (
        <div className="sign" style={{ borderTopColor: brandColor }}>
          <p className="sign-eyebrow" style={{ color: brandColor }}>
            Collect points with
          </p>
          <p className="sign-name">{name}</p>
          <div className="sign-qr" aria-hidden="true">
            {Array.from({ length: 25 }).map((_, index) => (
              <span key={index} className={index % 3 === 0 || index % 7 === 0 ? 'qron' : ''} />
            ))}
          </div>
          <p className="sign-line">Ask at the counter — your points live in the Poket app.</p>
        </div>
      )}

      <p className="muted small">
        The QR becomes a live link into the customer app when the store finder ships; today it
        prints as a placeholder with your colour and name.
      </p>
    </section>
  );
}

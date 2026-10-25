import type { Me } from './api';

interface StorePickerProps {
  me: Me;
  onChoose: (storeId: string) => void;
  onSignOut: () => void;
}

/** Shown when the caller owns or manages more than one store, or none yet. */
export function StorePicker({ me, onChoose, onSignOut }: StorePickerProps) {
  return (
    <main className="centered">
      <div className="card narrow">
        <p className="brand">
          <span className="brand-word">OmaPointii</span>
          <span className="brand-tag">Merchant Platform</span>
        </p>
        <h1>Which store?</h1>
        {me.memberships.length === 0 ? (
          <p className="muted">
            {me.staff.email} is not connected to a store yet. Contact BOKPOINTS support to
            create one, then sign in again.
          </p>
        ) : (
          <ul className="choices">
            {me.memberships.map((membership) => (
              <li key={membership.storeId}>
                <button
                  className="choice"
                  type="button"
                  onClick={() => onChoose(membership.storeId)}
                >
                  <span>{membership.storeName}</span>
                  <span className="muted">{membership.role}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className="ghost" type="button" onClick={onSignOut}>
          Sign out ({me.staff.email})
        </button>
      </div>
    </main>
  );
}

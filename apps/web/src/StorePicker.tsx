import type { Me } from './api';

interface StorePickerProps {
  me: Me;
  onChoose: (storeId: string) => void;
  onSignOut: () => void;
}

/** Shown when the caller works at more than one store, or at none yet. */
export function StorePicker({ me, onChoose, onSignOut }: StorePickerProps) {
  return (
    <main className="centered">
      <div className="card narrow">
        <p className="brand"><span className="brand-word">OmaPointii</span><span className="brand-tag">Store Portal</span></p>
        <h1>Which store?</h1>
        {me.memberships.length === 0 ? (
          <p className="muted">
            {me.staff.email} is not invited to a store yet. Ask the owner to invite you, then sign in
            again.
          </p>
        ) : (
          <ul className="choices">
            {me.memberships.map((membership) => (
              <li key={membership.storeId}>
                <button className="choice" type="button" onClick={() => onChoose(membership.storeId)}>
                  <span>{membership.storeName}</span>
                  <span className="muted">
                    {membership.role}
                    {membership.locationName === null ? '' : ` · ${membership.locationName}`}
                  </span>
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

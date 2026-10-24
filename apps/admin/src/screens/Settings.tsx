import type { Me } from '../api';

/** Account, security and the integrations this console waits on. */
export function SettingsScreen({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Settings</h1>
          <p className="sub">Your admin account, and what is not connected yet</p>
        </div>
      </div>

      <div className="grid two">
        <div className="grid" style={{ gap: 16 }}>
          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>Account</h3>
                <p className="sub">Platform scope</p>
              </div>
              <span className="pill danger">
                <span className="dot" aria-hidden="true" />
                Platform admin
              </span>
            </div>
            <dl className="kv">
              <div>
                <dt>Name</dt>
                <dd>{me.staff.name === '' ? 'Not set' : me.staff.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{me.staff.email}</dd>
              </div>
              <div>
                <dt>Second factor</dt>
                <dd>Authenticator app · required</dd>
              </div>
              <div>
                <dt>Idle sign-out</dt>
                <dd>After 15 minutes without a touch</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>Every store, read and act</dd>
              </div>
            </dl>
            <button className="ghost" type="button" onClick={onSignOut} style={{ marginTop: 14 }}>
              Sign out
            </button>
          </div>

          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>Security</h3>
                <p className="sub">How this console is kept separate</p>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              Admin accounts are separate from store accounts and are refused store-level actions
              they do not have. Every destructive action needs a reason and lands in the audit log.
              The role is shown in red at the top of every page so a store view can never be
              mistaken for this one.
            </p>
          </div>
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>Not connected yet</h3>
                <p className="sub">No dead switches</p>
              </div>
            </div>
            <div className="placeholdercard">
              <strong>Billing provider</strong>
              <p>Plans, invoices and the failed-payment schedule need Stripe (or equivalent).</p>
            </div>
            <div className="placeholdercard">
              <strong>Store owner invitations</strong>
              <p>Needs the platform’s email sender; until then stores are created by API.</p>
            </div>
            <div className="placeholdercard" style={{ marginBottom: 0 }}>
              <strong>Abuse flags</strong>
              <p>Safety actions wait for a report source and the anonymisation rules.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

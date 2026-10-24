import type { Tab } from '../Shell';

/**
 * Settings is an index, not a second billing page: it says what is already
 * live, what is arranged elsewhere, and what waits on the platform.
 */
export function SettingsScreen({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Settings</h1>
          <p className="sub">Your account, your store, and what is not connected yet</p>
        </div>
      </div>

      <div className="grid two">
        <div className="grid" style={{ gap: 16 }}>
          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>Your store</h3>
                <p className="sub">What customers see in their app</p>
              </div>
            </div>
            <div className="kv">
              <div>
                <dt>Name, address and contact</dt>
                <dd>
                  <button className="link" type="button" onClick={() => onNavigate('profile')}>
                    Store profile ›
                  </button>
                </dd>
              </div>
              <div>
                <dt>Branches</dt>
                <dd>
                  <button className="link" type="button" onClick={() => onNavigate('branches')}>
                    Branches ›
                  </button>
                </dd>
              </div>
              <div>
                <dt>Team and access</dt>
                <dd>
                  <button className="link" type="button" onClick={() => onNavigate('people')}>
                    People ›
                  </button>
                </dd>
              </div>
              <div>
                <dt>Counter sign</dt>
                <dd>
                  <button className="link" type="button" onClick={() => onNavigate('sign')}>
                    Open sign ›
                  </button>
                </dd>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>Account</h3>
                <p className="sub">Sign-in, language and plan</p>
              </div>
            </div>
            <div className="kv">
              <div>
                <dt>Second factor</dt>
                <dd>Authenticator app · required for every sign-in</dd>
              </div>
              <div>
                <dt>Idle sign-out</dt>
                <dd>After 15 minutes without a touch</dd>
              </div>
              <div>
                <dt>Plan and billing</dt>
                <dd>
                  <button className="link" type="button" onClick={() => onNavigate('billing')}>
                    Open billing ›
                  </button>
                </dd>
              </div>
              <div>
                <dt>Help</dt>
                <dd>
                  <button className="link" type="button" onClick={() => onNavigate('support')}>
                    Support &amp; FAQ ›
                  </button>
                </dd>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              To sign out, open the account menu at the bottom of the sidebar.
            </p>
          </div>
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>Not connected yet</h3>
                <p className="sub">Honest placeholders, no dead switches</p>
              </div>
            </div>

            <div className="placeholdercard">
              <strong>Store logo image</strong>
              <p>
                Your logo joins the brand colour when image storage is switched on. The colour,
                name and contact details already reach the customer app.
              </p>
            </div>

            <div className="placeholdercard">
              <strong>Staff invitations by email</strong>
              <p>
                Needs the platform’s email sender. Today the platform admin links people to your
                store.
              </p>
            </div>

            <div className="placeholdercard" style={{ marginBottom: 0 }}>
              <strong>Finnish interface</strong>
              <p>
                The dashboard is English until the Finnish translation is finished. Finnish
                number, date and price formats are already used.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

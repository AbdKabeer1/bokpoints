import { useCallback, useEffect, useState } from 'react';
import { ApiError, getMe, type Membership, type Me } from './api';
import { assuranceLevel, onAuthChange, signOut, supabase } from './auth';
import { Login } from './Login';
import { Splash } from './Splash';
import { Mfa } from './Mfa';
import { StorePicker } from './StorePicker';
import { RulesScreen } from './screens/Rules';
import { CustomersScreen } from './screens/Customers';
import { PeopleScreen } from './screens/People';
import { AuditScreen } from './screens/AuditScreen';
import { RewardsScreen } from './screens/Rewards';
import { DiscountScreen } from './screens/Discount';
import { ReportsScreen } from './screens/Reports';
import { BranchesScreen } from './screens/Branches';
import { ProfileScreen } from './screens/Profile';
import { CounterSignScreen } from './screens/CounterSign';
import { SettingsScreen } from './screens/Settings';

type Phase =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'needs-code'; email: string }
  | { kind: 'ready'; token: string; me: Me }
  | { kind: 'unreachable'; message: string };

type Tab =
  | 'rules'
  | 'customers'
  | 'rewards'
  | 'discount'
  | 'reports'
  | 'branches'
  | 'profile'
  | 'sign'
  | 'people'
  | 'audit'
  | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'reports', label: 'Reports' },
  { id: 'rules', label: 'Rules' },
  { id: 'customers', label: 'Customers' },
  { id: 'rewards', label: 'Rewards' },
  { id: 'discount', label: 'Discount' },
  { id: 'branches', label: 'Branches' },
  { id: 'profile', label: 'Store profile' },
  { id: 'sign', label: 'Counter sign' },
  { id: 'people', label: 'People' },
  { id: 'audit', label: 'Audit' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const [introDone, setIntroDone] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [chosenStoreId, setChosenStoreId] = useState<string | null>(null);
  const [idleWarn, setIdleWarn] = useState(false);
  const [tab, setTab] = useState<Tab>('rules');

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (session === null) {
      setPhase({ kind: 'signed-out' });
      return;
    }

    if ((await assuranceLevel()) !== 'aal2') {
      setPhase({ kind: 'needs-code', email: session.user.email ?? '' });
      return;
    }

    try {
      const me = await getMe(session.access_token);
      setPhase({ kind: 'ready', token: session.access_token, me });
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 401 || caught.code === 'MFA_REQUIRED')) {
        setPhase({ kind: 'signed-out' });
      } else {
        setPhase({
          kind: 'unreachable',
          message: caught instanceof Error ? caught.message : 'The API is not reachable.',
        });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onAuthChange(() => void refresh());
  }, [refresh]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setChosenStoreId(null);
    setPhase({ kind: 'signed-out' });
  }, []);

  // Idle sign-out, on the same terms as the till: a shared portal must not
  // stay open at the counter. The last minute shows a warning; any touch,
  // key or tap resets the clock.
  useEffect(() => {
    if (phase.kind !== 'ready') return;
    const LIMIT_MS = 15 * 60 * 1000;
    const WARN_MS = LIMIT_MS - 60 * 1000;
    let last = Date.now();
    const touch = () => {
      last = Date.now();
      setIdleWarn(false);
    };
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true });
    const timer = window.setInterval(() => {
      const idle = Date.now() - last;
      if (idle >= LIMIT_MS) void handleSignOut();
      else setIdleWarn(idle >= WARN_MS);
    }, 5000);
    return () => {
      for (const name of events) window.removeEventListener(name, touch);
      window.clearInterval(timer);
    };
  }, [phase.kind, handleSignOut]);

  if (!introDone) {
    return <Splash tagline="Merchant Platform" onDone={() => setIntroDone(true)} />;
  }

  switch (phase.kind) {
    case 'loading':
      return (
        <main className="centered">
          <p className="brand">
            <span className="brand-word">Poket</span>
            <span className="brand-tag">Merchant Platform</span>
          </p>
          <p className="muted">Starting…</p>
        </main>
      );
    case 'unreachable':
      return (
        <main className="centered">
          <div className="card narrow">
            <p className="brand">
              <span className="brand-word">Poket</span>
              <span className="brand-tag">Merchant Platform</span>
            </p>
            <h1>The platform is offline</h1>
            <p className="muted">{phase.message}</p>
            <button className="primary" type="button" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        </main>
      );
    case 'signed-out':
      return <Login onSignedIn={() => void refresh()} />;
    case 'needs-code':
      return (
        <Mfa
          email={phase.email}
          onVerified={() => void refresh()}
          onSignOut={() => void handleSignOut()}
        />
      );
    case 'ready': {
      const memberships = phase.me.memberships;
      const membership: Membership | undefined =
        memberships.find((candidate) => candidate.storeId === chosenStoreId) ??
        (memberships.length === 1 ? memberships[0] : undefined);

      if (membership === undefined) {
        return (
          <StorePicker
            me={phase.me}
            onChoose={setChosenStoreId}
            onSignOut={() => void handleSignOut()}
          />
        );
      }

      return (
        <div className="portal">
          {idleWarn && (
            <p className="idlewarn" role="status">
              Signing out in a minute — touch the screen to stay signed in.
            </p>
          )}
          <header className="topbar">
            <div>
              <p className="brand">
                <span className="brand-word">Poket</span>
                <span className="brand-tag">Merchant Platform</span>
              </p>
              <p className="store">{membership.storeName}</p>
            </div>
            <div className="who">
              <span className="muted">{phase.me.staff.email}</span>
              <button className="ghost small" type="button" onClick={() => void handleSignOut()}>
                Sign out
              </button>
            </div>
          </header>

          <nav className="tabs" aria-label="Sections">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={entry.id === tab ? 'tab active' : 'tab'}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>

          <main className="workspace">
            {tab === 'rules' && (
              <RulesScreen token={phase.token} storeId={membership.storeId} />
            )}
            {tab === 'customers' && (
              <CustomersScreen token={phase.token} storeId={membership.storeId} />
            )}
            {tab === 'rewards' && (
              <RewardsScreen token={phase.token} storeId={membership.storeId} />
            )}
            {tab === 'discount' && (
              <DiscountScreen token={phase.token} storeId={membership.storeId} />
            )}
            {tab === 'reports' && <ReportsScreen token={phase.token} storeId={membership.storeId} />}
            {tab === 'branches' && (
              <BranchesScreen token={phase.token} storeId={membership.storeId} />
            )}
            {tab === 'profile' && <ProfileScreen token={phase.token} storeId={membership.storeId} />}
            {tab === 'sign' && (
              <CounterSignScreen token={phase.token} storeId={membership.storeId} />
            )}
            {tab === 'people' && <PeopleScreen token={phase.token} storeId={membership.storeId} />}
            {tab === 'audit' && <AuditScreen token={phase.token} storeId={membership.storeId} />}
            {tab === 'settings' && <SettingsScreen />}
          </main>
        </div>
      );
    }
  }
}

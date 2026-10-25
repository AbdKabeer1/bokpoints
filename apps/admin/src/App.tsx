import { useCallback, useEffect, useState } from 'react';
import { ApiError, getMe, listSubscriptions, type Me } from './api';
import { assuranceLevel, onAuthChange, signOut, supabase } from './auth';
import { Shell, type Tab } from './Shell';
import { Login } from './Login';
import { Splash } from './Splash';
import { Mfa } from './Mfa';
import { StoresScreen } from './screens/Stores';
import { StoreDetailScreen } from './screens/StoreDetail';
import { SubscriptionsScreen } from './screens/Subscriptions';
import { SupportScreen } from './screens/Support';
import { SafetyScreen } from './screens/Safety';
import { AuditScreen } from './screens/AuditScreen';
import { SettingsScreen } from './screens/Settings';

type Phase =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'needs-code'; email: string }
  | { kind: 'not-admin'; me: Me }
  | { kind: 'ready'; token: string; me: Me }
  | { kind: 'unreachable'; message: string };

/**
 * The platform console (brief §4.3). A separate app on the same tokens and
 * shell as the merchant dashboard, but scoped to the platform and carrying a
 * permanent "Platform admin" label.
 */
export function App() {
  const [introDone, setIntroDone] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [idleWarn, setIdleWarn] = useState(false);
  const [tab, setTab] = useState<Tab>('stores');
  const [openStoreId, setOpenStoreId] = useState<string | null>(null);
  const [failedPayments, setFailedPayments] = useState(0);

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
      setPhase(
        me.staff.isAdmin
          ? { kind: 'ready', token: session.access_token, me }
          : { kind: 'not-admin', me },
      );
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

  // The sidebar badge counts subscriptions that need attention. A failure
  // just leaves it at zero; the page itself explains the state.
  useEffect(() => {
    if (phase.kind !== 'ready') return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await listSubscriptions(phase.token);
        if (!cancelled) {
          setFailedPayments(
            list.subscriptions.filter(
              (row) =>
                row.status === 'past_due' ||
                row.status === 'paused' ||
                row.status === 'suspended',
            ).length,
          );
        }
      } catch {
        if (!cancelled) setFailedPayments(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setOpenStoreId(null);
    setPhase({ kind: 'signed-out' });
  }, []);

  // Idle sign-out on the same terms as the other staff surfaces.
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
    return <Splash tagline="Platform Admin" onDone={() => setIntroDone(true)} />;
  }

  switch (phase.kind) {
    case 'loading':
      return (
        <main className="centered">
          <p className="brand">
            <span className="brand-word">OmaPointii</span>
            <span className="brand-tag">Platform Admin</span>
          </p>
          <p className="muted">Starting…</p>
        </main>
      );
    case 'unreachable':
      return (
        <main className="centered">
          <div className="card narrow">
            <p className="brand">
              <span className="brand-word">OmaPointii</span>
              <span className="brand-tag">Platform Admin</span>
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
    case 'not-admin':
      return (
        <main className="centered">
          <div className="card narrow">
            <p className="brand">
              <span className="brand-word">OmaPointii</span>
              <span className="brand-tag">Platform Admin</span>
            </p>
            <h1>Not a platform admin</h1>
            <p className="muted">
              {phase.me.staff.email} is signed in, but this account is a store account. The
              merchant dashboard is the right place for it.
            </p>
            <button className="primary" type="button" onClick={() => void handleSignOut()}>
              Sign out
            </button>
          </div>
        </main>
      );
    case 'ready':
      return (
        <Shell
          me={phase.me}
          active={openStoreId === null ? tab : 'stores'}
          badges={{ subscriptions: failedPayments, safety: 0 }}
          idleWarning={idleWarn}
          onNavigate={(next) => {
            setTab(next);
            setOpenStoreId(null);
          }}
          onSignOut={() => void handleSignOut()}
        >
          {openStoreId !== null ? (
            <StoreDetailScreen
              token={phase.token}
              storeId={openStoreId}
              onBack={() => setOpenStoreId(null)}
            />
          ) : (
            <>
              {tab === 'stores' && (
                <StoresScreen token={phase.token} onOpenStore={setOpenStoreId} />
              )}
              {tab === 'subscriptions' && <SubscriptionsScreen token={phase.token} />}
              {tab === 'support' && (
                <SupportScreen token={phase.token} onOpenStore={setOpenStoreId} />
              )}
              {tab === 'safety' && <SafetyScreen />}
              {tab === 'audit' && <AuditScreen token={phase.token} />}
              {tab === 'settings' && (
                <SettingsScreen me={phase.me} onSignOut={() => void handleSignOut()} />
              )}
            </>
          )}
        </Shell>
      );
  }
}

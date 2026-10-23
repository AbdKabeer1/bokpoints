import { useCallback, useEffect, useState } from 'react';
import { ApiError, getMe, type Me } from './api';
import { assuranceLevel, onAuthChange, signOut, supabase } from './auth';
import { Login } from './Login';
import { Mfa } from './Mfa';
import { StorePicker } from './StorePicker';
import { Till } from './Till';

type Phase =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'needs-code'; email: string }
  | { kind: 'ready'; token: string; me: Me }
  | { kind: 'unreachable'; message: string };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [chosenStoreId, setChosenStoreId] = useState<string | null>(null);

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

  switch (phase.kind) {
    case 'loading':
      return (
        <main className="centered">
          <p className="muted">Starting…</p>
        </main>
      );
    case 'unreachable':
      return (
        <main className="centered">
          <div className="card narrow">
            <p className="brand">Poket</p>
            <h1>The till is offline</h1>
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
      const membership =
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
        <Till
          token={phase.token}
          staffEmail={phase.me.staff.email}
          membership={membership}
          onSignOut={() => void handleSignOut()}
        />
      );
    }
  }
}

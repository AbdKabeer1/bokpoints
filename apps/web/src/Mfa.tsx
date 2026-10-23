import { useEffect, useState, type FormEvent } from 'react';
import { enrolTotp, existingTotpFactor, verifyTotp, type TotpEnrolment } from './auth';

interface MfaProps {
  email: string;
  onVerified: () => void;
  onSignOut: () => void;
}

/**
 * The second factor: verify with the code from the authenticator app, or, on
 * a staff member's first sign-in, set the authenticator up here. The API
 * refuses staff tokens without it (D-101).
 */
export function Mfa({ email, onVerified, onSignOut }: MfaProps) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = await existingTotpFactor();
        if (cancelled) return;
        if (existing !== null) {
          setFactorId(existing);
          return;
        }
        const created = await enrolTotp(email);
        if (cancelled) return;
        setFactorId(created.factorId);
        setEnrolment(created);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not start the authenticator setup');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (factorId === null) return;
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(factorId, code.trim());
      onVerified();
    } catch {
      setError('That code did not work. Wait for the next one and try again.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="centered">
      <form className="card narrow" onSubmit={(event) => void handleSubmit(event)}>
        <p className="brand"><span className="brand-word">Poket</span><span className="brand-tag">Store Portal</span></p>
        <h1>{enrolment === null ? 'Your 6-digit code' : 'Set up your authenticator'}</h1>

        {enrolment !== null && (
          <>
            <p className="muted">
              Add this key to your authenticator app (Google Authenticator, 1Password, Microsoft
              Authenticator), then type the 6 digits it shows.
            </p>
            <p className="secret">{enrolment.secret}</p>
            <p className="muted small">Advanced: the same secret as a link, for apps that accept one.</p>
            <p className="uri">{enrolment.uri}</p>
          </>
        )}

        <label htmlFor="code">Code</label>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          autoFocus
          required
        />
        {error !== null && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={busy || factorId === null || code.length !== 6}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
        <button className="ghost" type="button" onClick={onSignOut} disabled={busy}>
          Sign out
        </button>
      </form>
    </main>
  );
}

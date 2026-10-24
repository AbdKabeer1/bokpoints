import { useState, type FormEvent } from 'react';
import { signIn } from './auth';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      onSignedIn();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Sign-in failed';
      setError(
        message.toLowerCase().includes('invalid login credentials')
          ? 'Wrong email or password.'
          : message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="centered">
      <form className="card narrow" onSubmit={(event) => void handleSubmit(event)}>
        <p className="brand">
          <span className="brand-word">Poket</span>
          <span className="brand-tag">Platform Admin</span>
        </p>
        <h1>Platform sign-in</h1>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {error !== null && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted">The next step asks for your authenticator code.</p>
      </form>
    </main>
  );
}

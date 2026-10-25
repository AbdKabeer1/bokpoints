import { useState, type CSSProperties, type FormEvent } from 'react';
import { Gift, QrCode, ShieldCheck } from 'lucide-react';
import { signIn } from './auth';

const NAME = 'OmaPointii'.split('');

const PROOF = [
  { icon: QrCode, text: 'One code at the till' },
  { icon: Gift, text: 'Rewards the shop chooses' },
  { icon: ShieldCheck, text: 'Every point accounted for' },
];

/**
 * The merchant opening: a cinematic brand panel and the sign-in card, in one
 * composition. This is the one place on the merchant surfaces where expression
 * leads; everything behind it is a work surface.
 */
export function Landing({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
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
    <main className="landing">
      <div className="landing-ambient" aria-hidden="true">
        <span />
        <span />
      </div>

      <section className="landing-brand">
        <div className="landing-wordmark" aria-label="OmaPointii">
          {NAME.map((letter, index) => (
            <span
              key={`${letter}-${index}`}
              aria-hidden="true"
              style={{ '--i': index } as CSSProperties}
            >
              {letter}
            </span>
          ))}
        </div>

        <p className="landing-tagline">Loyalty that feels local.</p>
        <p className="landing-lede">
          Points, rewards and regulars for independent shops — one quiet system behind the
          counter.
        </p>

        <ul className="landing-proof">
          {PROOF.map((item) => (
            <li key={item.text}>
              <span className="prooficon" aria-hidden="true">
                <item.icon size={15} strokeWidth={1.9} />
              </span>
              {item.text}
            </li>
          ))}
        </ul>

        <p className="landing-foot">omapointii.store · merchant platform</p>
      </section>

      <section className="landing-panel">
        <form className="landing-form" onSubmit={(event) => void submit(event)}>
          <h1>Welcome back</h1>
          <p className="landing-sub">Sign in to your store. The authenticator code comes next.</p>

          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoFocus
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

          <p className="landing-small">
            Trouble signing in? Your platform admin can reset access. Sessions end after 15
            idle minutes.
          </p>
        </form>
      </section>
    </main>
  );
}

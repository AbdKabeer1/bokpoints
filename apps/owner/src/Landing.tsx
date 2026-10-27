import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  Gift,
  MapPin,
  Percent,
  QrCode,
  ShieldCheck,
  Store,
  Users,
} from 'lucide-react';
import { signIn } from './auth';

const CUSTOMER_APP = 'https://app.omapointii.store';
const CONTACT = 'hello@omapointii.store';

const SERVICES = [
  {
    icon: Percent,
    title: 'Earning rules, your call',
    body: 'Per euro, a fixed amount, every Nth visit or a specific product — with a per-sale ceiling and a simulator before you save.',
    points: ['Four rule types', 'Per-sale ceiling', 'Simulate before saving'],
  },
  {
    icon: Gift,
    title: 'Rewards your regulars want',
    body: 'Build a catalogue with points costs and daily limits. Customers redeem at the till; the points come out of their balance.',
    points: ['Your own catalogue', 'Daily limits', 'Redeem in one scan'],
  },
  {
    icon: QrCode,
    title: 'A discount that stays yours',
    body: 'One automatic basket discount, unlocked by a fresh 60-second QR and checked online. One per sale, no stacking, funded by you.',
    points: ['60-second QR', 'No stacking', 'No platform cut'],
  },
  {
    icon: Users,
    title: 'Know who comes back',
    body: 'See balances, visit history and contact details, adjust points with a reason, and send in-app campaigns only to customers who opted in.',
    points: ['Customer history', 'Audited adjustments', 'Consent-aware campaigns'],
  },
];

const MORE = [
  {
    icon: MapPin,
    title: 'Nearby businesses',
    body: 'See the shops and services around you and invite the ones you rate to join OmaPointii.',
  },
  {
    icon: Building2,
    title: 'Branches and team',
    body: 'Owners, managers and cashiers with the right access, and branch limits where you need them.',
  },
  {
    icon: BarChart3,
    title: 'Reports and audit',
    body: 'Thirty-day numbers for points, redemptions and visits, with every change in an append-only log.',
  },
];

const STEPS = [
  {
    title: 'The customer shows their code',
    body: 'A personal QR in the OmaPointii app — no card to carry and no app store required.',
  },
  {
    title: 'The cashier confirms the sale',
    body: 'The amount, the points preview and one confirm. Points land on the customer’s balance instantly.',
  },
  {
    title: 'They spend points with you',
    body: 'A reward from your catalogue or your basket discount, redeemed at your counter.',
  },
];

/**
 * The public front door of the merchant platform: what a shop gets, how the
 * counter works, what customers see, and a way into the sign-in. The sign-in
 * itself is one click away in the top menu, so a returning owner never has to
 * scroll through the story.
 */
export function Landing({ onSignedIn }: { onSignedIn: () => void }) {
  const [view, setView] = useState<'home' | 'login'>(() =>
    window.location.hash === '#login' ? 'login' : 'home',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openLogin = () => {
    setView('login');
    window.history.replaceState(null, '', '#login');
  };

  const closeLogin = () => {
    setView('home');
    window.history.replaceState(null, '', window.location.pathname);
  };

  useEffect(() => {
    const onHash = () => setView(window.location.hash === '#login' ? 'login' : 'home');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

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

  if (view === 'login') {
    return (
      <main className="mkt-login">
        <div className="mkt-login-inner">
          <button className="mkt-back" type="button" onClick={closeLogin}>
            <ArrowLeft size={16} strokeWidth={2} />
            Back to OmaPointii
          </button>

          <section className="mkt-login-card">
            <div className="mkt-brand mkt-brand-login" aria-label="OmaPointii">
              <span className="mkt-mark" aria-hidden="true">
                O
              </span>
              <span className="mkt-wordmark">OmaPointii</span>
              <span className="mkt-dot" aria-hidden="true" />
            </div>

            <h1>Welcome back</h1>
            <p className="mkt-login-sub">
              Sign in to your store. The authenticator code comes next.
            </p>

            <form className="mkt-login-form" onSubmit={(event) => void submit(event)}>
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

              <button className="mkt-btn mkt-btn-primary mkt-btn-wide" type="submit" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <p className="mkt-login-small">
              Trouble signing in? Your platform admin can reset access. Sessions end after 15
              idle minutes.
            </p>
          </section>

          <p className="mkt-login-foot">
            New to OmaPointii?{' '}
            <a href={`mailto:${CONTACT}`}>Talk to us</a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mkt">
      <header className="mkt-nav">
        <a className="mkt-brand" href="#top" aria-label="OmaPointii home">
          <span className="mkt-mark" aria-hidden="true">
            O
          </span>
          <span className="mkt-wordmark">OmaPointii</span>
          <span className="mkt-dot" aria-hidden="true" />
        </a>

        <nav className="mkt-links" aria-label="Sections">
          <a href="#services">What you get</a>
          <a href="#how">How it works</a>
          <a href="#customers">For customers</a>
        </nav>

        <div className="mkt-nav-actions">
          <button className="mkt-btn mkt-btn-login" type="button" onClick={openLogin}>
            Log in
          </button>
        </div>
      </header>

      <section className="mkt-hero" id="top">
        <div className="mkt-hero-copy">
          <h1>
            Turn first visits into <span className="mkt-accent">regulars.</span>
          </h1>
          <p className="mkt-lede">
            OmaPointii gives independent shops a loyalty system they own: points, rewards and
            discounts at the till, plus a clear view of who keeps coming back. No marketplace
            between you and your customer.
          </p>

          <div className="mkt-actions">
            <a className="mkt-btn mkt-btn-primary" href="#services">
              See what you get
              <ArrowRight size={16} strokeWidth={2} />
            </a>
            <button className="mkt-btn mkt-btn-ghost" type="button" onClick={openLogin}>
              Log in
            </button>
          </div>

          <ul className="mkt-trust">
            <li>
              <Check size={15} strokeWidth={2.4} /> No marketplace cut
            </li>
            <li>
              <Check size={15} strokeWidth={2.4} /> Runs on a phone or tablet
            </li>
            <li>
              <Check size={15} strokeWidth={2.4} /> Every point audited
            </li>
          </ul>
        </div>

        <div className="mkt-hero-art" aria-label="Preview of the merchant dashboard">
          <div className="mkt-mock">
            <div className="mkt-mock-head">
              <span>Today at the counter</span>
              <span className="mkt-mock-live">Live</span>
            </div>
            <div className="mkt-mock-stats">
              <div>
                <strong>248</strong>
                <span>points issued</span>
              </div>
              <div>
                <strong>31</strong>
                <span>visits</span>
              </div>
              <div>
                <strong>12</strong>
                <span>regulars</span>
              </div>
            </div>
            <div className="mkt-mock-chart" aria-hidden="true">
              {[38, 52, 44, 68, 58, 82, 74].map((height, index) => (
                <span key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
            <div className="mkt-mock-row">
              <span className="mkt-avatar">A</span>
              <span className="mkt-mock-name">Aino M.</span>
              <span className="mkt-mock-points">+12 pts</span>
            </div>
            <div className="mkt-mock-row">
              <span className="mkt-avatar">M</span>
              <span className="mkt-mock-name">Matti K.</span>
              <span className="mkt-mock-points">+8 pts</span>
            </div>
            <div className="mkt-mock-foot">
              <Gift size={15} strokeWidth={2} />
              Reward unlocked · Free coffee
            </div>
          </div>
          <p className="mkt-mock-caption">A preview of the merchant dashboard.</p>
        </div>
      </section>

      <section className="mkt-section" id="services">
        <div className="mkt-section-head">
          <h2>Everything behind the counter, in one place.</h2>
          <p>
            Set the rules once, then let the till do the work. The shop keeps the points, the
            rewards and the relationship.
          </p>
        </div>

        <div className="mkt-grid">
          {SERVICES.map((service) => (
            <article className="mkt-card" key={service.title}>
              <span className="mkt-icon" aria-hidden="true">
                <service.icon size={20} strokeWidth={2} />
              </span>
              <h3>{service.title}</h3>
              <p>{service.body}</p>
              <ul>
                {service.points.map((point) => (
                  <li key={point}>
                    <Check size={15} strokeWidth={2.4} />
                    {point}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div className="mkt-more">
          {MORE.map((item) => (
            <div className="mkt-more-item" key={item.title}>
              <span className="mkt-icon mkt-icon-small" aria-hidden="true">
                <item.icon size={17} strokeWidth={2} />
              </span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mkt-section mkt-section-soft" id="how">
        <div className="mkt-section-head">
          <h2>Three beats at the till.</h2>
          <p>No new hardware and no second queue. The whole exchange fits in the sale you already do.</p>
        </div>

        <div className="mkt-steps">
          {STEPS.map((step, index) => (
            <div className="mkt-step" key={step.title}>
              <span className="mkt-step-number">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mkt-section" id="customers">
        <div className="mkt-customers">
          <div>
            <h2>For shoppers, it is one code.</h2>
            <p className="mkt-customers-lede">
              Your customers collect points at every OmaPointii shop, see exactly when they
              expire, and spend them where they earned them — not in a marketplace wallet.
            </p>
            <ul className="mkt-list">
              <li>
                <Check size={16} strokeWidth={2.4} /> One personal QR, no app store needed
              </li>
              <li>
                <Check size={16} strokeWidth={2.4} /> Points, expiry and visit history in one place
              </li>
              <li>
                <Check size={16} strokeWidth={2.4} /> Rewards and discounts from the shops they visit
              </li>
              <li>
                <Check size={16} strokeWidth={2.4} /> Nearby shops and services in the Stores tab
              </li>
            </ul>
            <a className="mkt-btn mkt-btn-primary" href={CUSTOMER_APP}>
              Open the customer app
              <ArrowRight size={16} strokeWidth={2} />
            </a>
          </div>

          <div>
            <div className="mkt-phone" aria-label="Preview of the customer app">
              <div className="mkt-phone-bar" />
              <div className="mkt-phone-card">
                <span className="mkt-phone-label">Your points</span>
                <strong>1,240</strong>
                <span className="mkt-phone-sub">across 4 shops</span>
              </div>
              <div className="mkt-phone-row">
                <span className="mkt-avatar">K</span>
                <div>
                  <strong>Kahvila Bea</strong>
                  <small>320 points · Free coffee</small>
                </div>
              </div>
              <div className="mkt-phone-row">
                <span className="mkt-avatar">S</span>
                <div>
                  <strong>Salon Bror</strong>
                  <small>180 points · 40 to a haircut</small>
                </div>
              </div>
              <div className="mkt-phone-qr" aria-hidden="true">
                <QrCode size={46} strokeWidth={1.6} />
                <span>Show my code</span>
              </div>
            </div>
            <p className="mkt-mock-caption">A preview of the customer app.</p>
          </div>
        </div>
      </section>

      <section className="mkt-proof">
        <div className="mkt-proof-item">
          <ShieldCheck size={20} strokeWidth={2} />
          <h3>Your customers stay yours</h3>
          <p>No marketplace cut, no resale, no second brand between you and the regular.</p>
        </div>
        <div className="mkt-proof-item">
          <Store size={20} strokeWidth={2} />
          <h3>Every point is accounted for</h3>
          <p>An append-only ledger, versioned rules and a reason on every manual adjustment.</p>
        </div>
        <div className="mkt-proof-item">
          <QrCode size={20} strokeWidth={2} />
          <h3>Built for the counter</h3>
          <p>A browser till on the device you already have, with a clear answer when it is offline.</p>
        </div>
      </section>

      <section className="mkt-cta">
        <h2>See it at your own counter.</h2>
        <p>Log in to the merchant platform, or talk to us about a pilot for your shop.</p>
        <div className="mkt-actions mkt-actions-center">
          <button className="mkt-btn mkt-btn-primary" type="button" onClick={openLogin}>
            Log in to your store
            <ArrowRight size={16} strokeWidth={2} />
          </button>
          <a className="mkt-btn mkt-btn-ghost" href={`mailto:${CONTACT}`}>
            Talk to us
          </a>
        </div>
      </section>

      <footer className="mkt-footer">
        <div className="mkt-footer-brand">
          <div className="mkt-brand">
            <span className="mkt-mark" aria-hidden="true">
              O
            </span>
            <span className="mkt-wordmark">OmaPointii</span>
            <span className="mkt-dot" aria-hidden="true" />
          </div>
          <p>Loyalty that feels local.</p>
        </div>

        <div className="mkt-footer-cols">
          <div>
            <h4>Shop owners</h4>
            <a href="#services">What you get</a>
            <a href="#how">How it works</a>
            <button type="button" onClick={openLogin}>
              Log in
            </button>
          </div>
          <div>
            <h4>Customers</h4>
            <a href={CUSTOMER_APP}>Open the customer app</a>
            <a href="#customers">What customers see</a>
          </div>
          <div>
            <h4>Contact</h4>
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
            <a href="mailto:privacy@omapointii.store">privacy@omapointii.store</a>
          </div>
        </div>

        <p className="mkt-copyright">© 2026 OmaPointii · Merchant platform</p>
      </footer>
    </main>
  );
}

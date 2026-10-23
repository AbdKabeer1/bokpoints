import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  award,
  getBalance,
  identify,
  previewAward,
  recentAwards,
  registerCustomer,
  type AwardBody,
  type AwardPreview,
  type Identified,
  type Membership,
  type RecentAwards,
} from './api';
import { cashierMessage, HELP_LINE } from './errors';
import { formatDate, isEmail, normalizeScan, parseAmountToCents } from './format';
import { ScanCamera } from './ScanCamera';
import { playScanOk } from './sound';

interface TillProps {
  token: string;
  staffEmail: string;
  membership: Membership;
  onSignOut: () => void;
}

interface AwardRecorded {
  points: number;
  balance: number;
  expiresAt: string | null;
}

/** Plain names for the breakdown rows a cashier reads at a glance. */
const RULE_LABELS: Record<string, string> = {
  per_euro: 'per euro',
  fixed_per_purchase: 'per purchase',
  threshold_bonus: 'threshold bonus',
  every_nth_visit: 'every Nth visit',
};

/**
 * The till itself: scan → customer → amount → confirm → recorded.
 *
 * The scanner types the code and presses Enter, so the scan field is a
 * normal form input and stays focused whenever the till waits for a scan.
 * A human can type a code and press Enter as a fallback.
 */
export function Till({ token, staffEmail, membership, onSignOut }: TillProps) {
  const [scanValue, setScanValue] = useState('');
  const [customer, setCustomer] = useState<Identified | null>(null);
  const [amount, setAmount] = useState('');
  const [branchId, setBranchId] = useState<string | null>(
    membership.locationId ?? membership.branches[0]?.id ?? null,
  );
  const [preview, setPreview] = useState<AwardPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState<AwardRecorded | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerName, setRegisterName] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [recent, setRecent] = useState<RecentAwards['entries'] | null>(null);
  const [flashOk, setFlashOk] = useState(false);
  const [idleWarn, setIdleWarn] = useState(false);

  const scanRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  /** The branch this award lands on: the member's own limit, else the picked one. */
  const effectiveLocationId = membership.locationId ?? branchId;

  const bodyFor = (target: Identified, cents: number): AwardBody => ({
    customerId: target.customerId,
    amountCents: cents,
    ...(effectiveLocationId === null ? {} : { locationId: effectiveLocationId }),
  });

  useEffect(() => {
    if (recorded !== null) return;
    if (customer !== null) amountRef.current?.focus();
    else if (registerOpen) emailRef.current?.focus();
    else scanRef.current?.focus();
  }, [customer, recorded, registerOpen]);

  // Live preview, debounced: the maths stays on the server, so typing never
  // drifts from what the award will actually do.
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (customer === null) return;

    const cents = parseAmountToCents(amount);
    if (cents === null) return;

    let cancelled = false;
    setPreviewLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await previewAward(token, membership.storeId, bodyFor(customer, cents));
          if (!cancelled) setPreview(result);
        } catch (caught) {
          if (!cancelled) {
            setPreviewError(
              caught instanceof ApiError ? cashierMessage(caught.code) : 'Could not check the amount.',
            );
          }
        } finally {
          if (!cancelled) setPreviewLoading(false);
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [amount, customer, token, membership.storeId, effectiveLocationId]);

  /** What this till last recorded (FR-STO-9). A failure just shows nothing. */
  const loadRecent = useCallback(async () => {
    try {
      setRecent((await recentAwards(token, membership.storeId)).entries);
    } catch {
      setRecent(null);
    }
  }, [token, membership.storeId]);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  // Idle sign-out: a shared till must not stay open at the counter. The
  // last minute shows a warning; any touch, key or tap resets the clock.
  useEffect(() => {
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
      if (idle >= LIMIT_MS) onSignOut();
      else setIdleWarn(idle >= WARN_MS);
    }, 5000);
    return () => {
      for (const name of events) window.removeEventListener(name, touch);
      window.clearInterval(timer);
    };
  }, [onSignOut]);

  /**
   * One identify path for both ways of reading a code — the scanner that
   * types, and the camera. Success beeps, shows the customer and flashes
   * the card; failure says why and returns focus to the scan field.
   */
  const runIdentify = async (code: string): Promise<boolean> => {
    if (code === '') return false;

    setBusy(true);
    setError(null);
    try {
      setCustomer(await identify(token, membership.storeId, code));
      setScanValue('');
      playScanOk();
      setFlashOk(true);
      window.setTimeout(() => setFlashOk(false), 900);
      return true;
    } catch (caught) {
      setError(caught instanceof ApiError ? cashierMessage(caught.code) : 'The API is not answering.');
      setScanValue('');
      scanRef.current?.focus();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleScan = async (event: FormEvent) => {
    event.preventDefault();
    await runIdentify(normalizeScan(scanValue));
  };

  /** A camera read: keep the camera open on a miss so they can try again. */
  const handleCameraRead = async (text: string) => {
    const ok = await runIdentify(normalizeScan(text));
    if (ok) setCameraOpen(false);
  };

  const handleConfirm = async () => {
    if (customer === null) return;
    const cents = parseAmountToCents(amount);
    if (cents === null) return;

    setBusy(true);
    setError(null);
    try {
      const result = await award(token, membership.storeId, bodyFor(customer, cents));
      const balance = await getBalance(token, membership.storeId, customer.customerId);
      setRecorded({
        points: result.points,
        balance: balance.balance,
        expiresAt: preview?.expiresAt ?? null,
      });
      void loadRecent();
    } catch (caught) {
      setError(caught instanceof ApiError ? cashierMessage(caught.code) : 'Could not record the award.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();
    const email = registerEmail.trim().toLowerCase();
    if (!isEmail(email)) {
      setRegisterError('That does not look like an email address.');
      return;
    }

    setBusy(true);
    setRegisterError(null);
    try {
      const created = await registerCustomer(token, membership.storeId, {
        email,
        ...(registerName.trim() === '' ? {} : { name: registerName.trim() }),
      });
      setCustomer({
        customerId: created.customerId,
        firstName: created.firstName,
        balance: created.balance,
      });
      setRegisterOpen(false);
      setRegisterEmail('');
      setRegisterName('');
    } catch (caught) {
      setRegisterError(
        caught instanceof ApiError ? cashierMessage(caught.code) : 'Could not register them.',
      );
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setCustomer(null);
    setAmount('');
    setPreview(null);
    setPreviewError(null);
    setRecorded(null);
    setError(null);
    setScanValue('');
  };

  const cents = parseAmountToCents(amount);
  const stageIndex = recorded !== null ? 4 : customer !== null ? 2 : 1;

  const previewLine = () => {
    if (amount.trim() === '') return 'Type what the register charged.';
    if (cents === null) return 'That does not look like an amount.';
    if (previewLoading) return 'Checking…';
    if (previewError !== null) return previewError;
    if (preview === null) return '';
    if (!preview.awarded) return cashierMessage(preview.reason ?? 'below_minimum');
    const at = preview.locationName === null ? '' : ` at ${preview.locationName}`;
    const until = preview.expiresAt === null ? '' : `, expiring ${formatDate(preview.expiresAt)}`;
    return `Earns ${preview.points} points${at}${until}.`;
  };

  return (
    <main className="till">
      {idleWarn && (
        <p className="idlewarn" role="status">
          Signing out in a minute — touch the screen to stay signed in.
        </p>
      )}
      <header className="topbar">
        <div>
          <p className="brand"><span className="brand-word">Poket</span><span className="brand-tag">Store Portal</span></p>
          <p className="store">
            {membership.storeName}
            <span className="muted">
              {' · '}
              {membership.locationName ?? (membership.branches.length > 0 ? 'pick a branch' : 'all branches')}
            </span>
          </p>
        </div>
        <div className="who">
          <span className="muted">{staffEmail}</span>
          <button className="ghost small" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="steps" aria-label="Sale steps">
        {['Find the customer', 'Add the amount', 'Confirm the sale'].map((label, index) => {
          const position = index + 1;
          const state = position < stageIndex ? 'done' : position === stageIndex ? 'active' : 'idle';
          return (
            <span key={label} className={`step ${state}`}>
              <span className="stepnum">{state === 'done' ? '✓' : position}</span>
              {label}
            </span>
          );
        })}
      </nav>

      <section className={flashOk ? 'card tillcard flash-ok' : 'card tillcard'}>
        {recorded !== null ? (
          <div className="result">
            <div className="resultmark" aria-hidden="true">✓</div>
            <p className="eyebrow">Recorded</p>
            <p className="big">+{recorded.points} points</p>
            <p className="muted">
              New balance: {recorded.balance} points
              {recorded.expiresAt === null ? '' : ` · expires ${formatDate(recorded.expiresAt)}`}
            </p>
            <button className="primary" type="button" onClick={reset}>
              Next customer
            </button>
          </div>
        ) : customer === null ? (
          registerOpen ? (
            <form className="scan" onSubmit={(event) => void handleRegister(event)}>
              <p className="eyebrow">Customer without the app</p>
              <p className="muted">
                Their points are held on this email and appear when they first sign in with it.
              </p>
              <label htmlFor="register-email">Email</label>
              <input
                id="register-email"
                ref={emailRef}
                value={registerEmail}
                onChange={(event) => setRegisterEmail(event.target.value)}
                placeholder="customer@example.com"
                autoComplete="off"
                autoFocus
                disabled={busy}
                aria-label="Customer email"
              />
              <label htmlFor="register-name">First name (optional)</label>
              <input
                id="register-name"
                value={registerName}
                onChange={(event) => setRegisterName(event.target.value)}
                placeholder="Aino"
                autoComplete="off"
                disabled={busy}
              />
              {registerError !== null && <p className="error">{registerError}</p>}
              <div className="actions">
                <button
                  className="primary"
                  type="submit"
                  disabled={busy || registerEmail.trim() === ''}
                >
                  {busy ? 'Registering…' : 'Register and continue'}
                </button>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => {
                    setRegisterOpen(false);
                    setRegisterError(null);
                  }}
                  disabled={busy}
                >
                  Back to scanning
                </button>
              </div>
            </form>
          ) : (
            <>
            <form className="scan" onSubmit={(event) => void handleScan(event)}>
              <p className="eyebrow">Scan member code</p>
              <input
                ref={scanRef}
                className="scaninput"
                value={scanValue}
                onChange={(event) => setScanValue(event.target.value)}
                placeholder="Scan the card or type the code"
                autoComplete="off"
                autoFocus
                disabled={busy}
                aria-label="Member code"
              />
              <button className="primary" type="submit" disabled={busy || scanValue.trim() === ''}>
                {busy ? 'Looking…' : 'Find customer'}
              </button>
              <p className="muted">A scanner types the code and presses Enter. Typing works too.</p>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  setError(null);
                  setRegisterOpen(true);
                }}
                disabled={busy}
              >
                Customer without the app
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  setError(null);
                  setCameraOpen(true);
                }}
                disabled={busy}
              >
                Scan with camera
              </button>
            </form>
            {recent !== null && recent.length > 0 && (
              <div className="recent">
                <p className="eyebrow">Latest at this till</p>
                {recent.map((entry) => (
                  <p className="recentline" key={entry.entryId}>
                    <span className="recenttime">
                      {new Date(entry.createdAt).toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="recentname">{entry.customerName}</span>
                    <span className="recentpoints">+{entry.points}</span>
                  </p>
                ))}
              </div>
            )}
            </>
          )
        ) : cameraOpen ? (
          <ScanCamera
            onRead={(text) => void handleCameraRead(text)}
            onClose={() => setCameraOpen(false)}
          />
        ) : (
          <div className="customer">
            <p className="eyebrow">Customer</p>
            <p className="big">{customer.firstName || 'New customer'}</p>
            <p className="muted">{customer.balance} points at this store</p>

            {membership.locationId === null && membership.branches.length > 1 && (
              <>
                <label htmlFor="branch">Branch</label>
                <select
                  id="branch"
                  value={branchId ?? ''}
                  onChange={(event) => setBranchId(event.target.value)}
                  disabled={busy}
                >
                  {membership.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label htmlFor="amount">Purchase amount</label>
            <div className="money">
              <span className="money-euro" aria-hidden="true">€</span>
              <input
                id="amount"
                ref={amountRef}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="12,50"
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                aria-label="Purchase amount in euros"
              />
            </div>
            {preview !== null && preview.awarded ? (
              <div className="earn">
                <p className="big">
                  +{preview.points}
                  <span className="earnunit"> pts</span>
                </p>
                <p className="earnsub">
                  on €{amount.trim()}
                  {preview.locationName === null ? '' : ` · at ${preview.locationName}`}
                  {preview.expiresAt === null ? '' : ` · expires ${formatDate(preview.expiresAt)}`}
                </p>
                {preview.breakdown !== undefined && preview.breakdown.length > 0 && (
                  <ul className="breakdown" aria-label="Which rules gave the points">
                    {preview.breakdown.map((entry, index) => (
                      <li key={`${entry.type}-${entry.version}-${index}`}>
                        {entry.applied
                          ? `+${entry.points} pts · ${RULE_LABELS[entry.type] ?? entry.type} (v${entry.version})`
                          : `no pts · ${RULE_LABELS[entry.type] ?? entry.type} — ${cashierMessage(entry.reason ?? 'condition_not_met')}`}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className={previewError !== null ? 'preview error' : 'preview'}>{previewLine()}</p>
            )}

            <div className="actions">
              <button
                className="primary"
                type="button"
                onClick={() => void handleConfirm()}
                disabled={busy || preview === null || !preview.awarded}
              >
                {busy ? 'Recording…' : preview !== null && preview.awarded ? `Confirm +${preview.points}` : 'Confirm'}
              </button>
              <button className="ghost" type="button" onClick={reset} disabled={busy}>
                Wrong customer
              </button>
            </div>
          </div>
        )}

        {error !== null && <p className="error">{error}</p>}
        <p className="helpline muted small">{HELP_LINE}</p>
      </section>
    </main>
  );
}

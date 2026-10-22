import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  award,
  getBalance,
  identify,
  previewAward,
  registerCustomer,
  type AwardBody,
  type AwardPreview,
  type Identified,
  type Membership,
} from './api';
import { cashierMessage } from './errors';
import { formatDate, isEmail, normalizeScan, parseAmountToCents } from './format';

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

  const handleScan = async (event: FormEvent) => {
    event.preventDefault();
    const code = normalizeScan(scanValue);
    if (code === '') return;

    setBusy(true);
    setError(null);
    try {
      setCustomer(await identify(token, membership.storeId, code));
      setScanValue('');
    } catch (caught) {
      setError(caught instanceof ApiError ? cashierMessage(caught.code) : 'The API is not answering.');
      setScanValue('');
      scanRef.current?.focus();
    } finally {
      setBusy(false);
    }
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
      <header className="topbar">
        <div>
          <p className="brand">BOKPOINTS</p>
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

      <section className="card tillcard">
        {recorded !== null ? (
          <div className="result">
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
            </form>
          )
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

            <label htmlFor="amount">Purchase (€)</label>
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
            <p className={previewError !== null ? 'preview error' : 'preview'}>{previewLine()}</p>

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
      </section>
    </main>
  );
}

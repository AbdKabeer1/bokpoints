import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  award,
  availableRewards,
  getBalance,
  verifyDiscountProof,
  identify,
  previewAward,
  recentAwards,
  registerCustomer,
  type AwardBody,
  type AwardPreview,
  type Identified,
  type Membership,
  type RecentAwards,
  type TillReward,
} from './api';
import { APP_VERSION } from '@bokpoints/shared';
import { cameraProblem, requestCameraAccess, tillPanelMode } from './camera';
import { cashierMessage, HELP_LINE } from './errors';
import { formatCents, formatDate, isEmail, normalizeScan, parseAmountToCents } from './format';
import { ScanCamera } from './ScanCamera';
import { playScanOk } from './sound';

/** "Online · 14:10" or "Offline · 3 waiting" for the top bar. */
function useConnection(): { online: boolean; time: string } {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const timer = window.setInterval(() => setTime(new Date()), 30_000);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      window.clearInterval(timer);
    };
  }, []);
  return {
    online,
    time: time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  };
}

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
  /** The reward this confirm paid for, if any (D-138). */
  redeemed: { name: string; pointsCost: number } | null;
}

/** Plain names for the breakdown rows a cashier reads at a glance. */
/** Why a rotating code did not verify, in words a cashier can say out loud. */
const DISCOUNT_HINTS: Record<string, string> = {
  invalid: 'That code is not recognised. Ask them to show it again.',
  expired: 'That code has expired. Ask them to show the fresh one.',
  used: 'That code has already been used.',
  below_threshold: 'This purchase is below the discount threshold.',
  no_rule: 'No discount is running here right now.',
};

const RULE_LABELS: Record<string, string> = {
  per_euro: 'per euro',
  fixed_per_purchase: 'per purchase',
  threshold_bonus: 'threshold bonus',
  every_nth_visit: 'every Nth visit',
};

/**
 * The till itself: scan → customer → amount → payment taken → recorded.
 *
 * The payment step is its own beat (WP3): the cashier takes the money in
 * the store's own till or card terminal, presses "Payment taken", checks
 * the amount actually paid, and only then records — points follow the paid
 * amount (D-129).
 *
 * The scanner types the code and presses Enter, so the scan field is a
 * normal form input and stays focused whenever the till waits for a scan.
 * A human can type a code and press Enter as a fallback.
 */
export function Till({ token, staffEmail, membership, onSignOut }: TillProps) {
  const [scanValue, setScanValue] = useState('');
  const [customer, setCustomer] = useState<Identified | null>(null);
  const [amount, setAmount] = useState('');
  // WP3: null until the cashier says the payment was taken; then the
  // editable amount actually paid, which is what the points follow (D-129).
  const [paid, setPaid] = useState<string | null>(null);
  // D-138: the catalog the picker offers once payment is being taken, and
  // the reward the customer chose. Nothing is spent until the confirm.
  const [rewards, setRewards] = useState<TillReward[] | null>(null);
  const [selectedReward, setSelectedReward] = useState<
    { rewardId: string; name: string; pointsCost: number } | null
  >(null);
  // D-133: the customer's rotating discount code, once the till has checked
  // it. The confirm consumes it; the paid step starts from the discounted sum.
  const [discount, setDiscount] = useState<{ proof: string; discountCents: number } | null>(null);
  const [discountInput, setDiscountInput] = useState('');
  const [discountMsg, setDiscountMsg] = useState<string | null>(null);
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
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraInitialProblem, setCameraInitialProblem] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentAwards['entries'] | null>(null);
  // The store's catalog for the progress bar, loaded as soon as a customer is
  // known — before the amount — so the card can show the next reward.
  const [catalog, setCatalog] = useState<TillReward[] | null>(null);
  const connection = useConnection();
  const [flashOk, setFlashOk] = useState(false);
  const [idleWarn, setIdleWarn] = useState(false);

  const scanRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  /** The branch this award lands on: the member's own limit, else the picked one. */
  const effectiveLocationId = membership.locationId ?? branchId;

  const bodyFor = (target: Identified, cents: number, paidCents?: number): AwardBody => ({
    customerId: target.customerId,
    amountCents: cents,
    ...(paidCents === undefined ? {} : { amountPaidCents: paidCents }),
    ...(selectedReward === null ? {} : { redeemRewardId: selectedReward.rewardId }),
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
    // In the payment step the quote follows what will be paid (D-129); a
    // half-typed paid amount just waits, like a half-typed charge does.
    const paidCents = paid === null ? cents : parseAmountToCents(paid);
    if (paidCents === null) return;

    let cancelled = false;
    setPreviewLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await previewAward(
            token,
            membership.storeId,
            bodyFor(customer, cents, paid === null ? undefined : paidCents),
          );
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
  }, [amount, paid, selectedReward, customer, token, membership.storeId, effectiveLocationId]);

  // The picker's catalog, loaded once when the payment step opens: a
  // failed load just hides the picker — awarding never depends on it.
  const inPayStep = paid !== null;
  useEffect(() => {
    if (!inPayStep || customer === null) return;
    let cancelled = false;
    // The picker follows the paid amount, debounced like the quote: the
    // affordability it shows is what the confirm will accept (D-145).
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const paidCents = parseAmountToCents(paid ?? '') ?? undefined;
          const result = await availableRewards(
            token,
            membership.storeId,
            customer.customerId,
            paidCents,
          );
          if (!cancelled) setRewards(result.rewards);
        } catch {
          if (!cancelled) setRewards(null);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inPayStep, paid, customer, token, membership.storeId]);

  // The customer card's progress toward the next reward (brief §4.1).
  useEffect(() => {
    if (customer === null) {
      setCatalog(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await availableRewards(token, membership.storeId, customer.customerId);
        if (!cancelled) setCatalog(result.rewards);
      } catch {
        if (!cancelled) setCatalog(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customer, token, membership.storeId]);

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

  /**
   * Ask while this function still belongs to the cashier's tap. In
   * particular, iPhone Safari may not show a permission prompt when the first
   * getUserMedia call happens later from a component effect.
   */
  const openCamera = async () => {
    setCameraStarting(true);
    setError(null);
    try {
      await requestCameraAccess();
      setCameraInitialProblem(null);
      setCameraOpen(true);
    } catch (caught) {
      // Still open the panel: Take QR photo launches the phone's native
      // camera even when a live browser stream is unavailable.
      setCameraInitialProblem(cameraProblem(caught));
      setCameraOpen(true);
    } finally {
      setCameraStarting(false);
    }
  };

  /** A camera read: keep the camera open on a miss so they can try again. */
  const handleCameraRead = async (text: string) => {
    const ok = await runIdentify(normalizeScan(text));
    if (ok) setCameraOpen(false);
  };

  /** The dry run for a rotating code: fresh, theirs, and worth something here. */
  const handleDiscountVerify = async (event: FormEvent) => {
    event.preventDefault();
    if (customer === null || cents === null) return;
    const proof = normalizeScan(discountInput);
    if (proof === '') return;

    setBusy(true);
    setError(null);
    setDiscountMsg(null);
    try {
      const result = await verifyDiscountProof(token, membership.storeId, {
        proof,
        amountCents: cents,
        customerId: customer.customerId,
      });
      if (result.valid) {
        setDiscount({ proof, discountCents: result.discountCents });
        setDiscountInput('');
      } else {
        setDiscount(null);
        setDiscountMsg(
          DISCOUNT_HINTS[result.reason ?? 'invalid'] ?? 'That code is not recognised.',
        );
      }
    } catch (caught) {
      setDiscountMsg(
        caught instanceof ApiError ? cashierMessage(caught.code) : 'Could not check the code.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (customer === null) return;
    const cents = parseAmountToCents(amount);
    if (cents === null) return;
    const paidCents = paid === null ? cents : parseAmountToCents(paid);
    if (paidCents === null) return;

    setBusy(true);
    setError(null);
    try {
      const result = await award(
        token,
        membership.storeId,
        bodyFor(customer, cents, paid === null ? undefined : paidCents),
      );
      const balance = await getBalance(token, membership.storeId, customer.customerId);
      setRecorded({
        points: result.points,
        balance: balance.balance,
        expiresAt: preview?.expiresAt ?? null,
        redeemed: result.redeemed,
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
    setPaid(null);
    setRewards(null);
    setSelectedReward(null);
    setDiscount(null);
    setDiscountInput('');
    setDiscountMsg(null);
    setPreview(null);
    setPreviewError(null);
    setRecorded(null);
    setError(null);
    setScanValue('');
  };

  const cents = parseAmountToCents(amount);
  const stageIndex = recorded !== null ? 4 : paid !== null ? 3 : customer !== null ? 2 : 1;
  const panelMode = tillPanelMode({
    hasRecordedSale: recorded !== null,
    cameraOpen,
    hasCustomer: customer !== null,
    registerOpen,
  });

  const previewLine = () => {
    if (amount.trim() === '') return 'Type what the register charged.';
    if (cents === null) return 'That does not look like an amount.';
    if (paid !== null) {
      const paidCents = parseAmountToCents(paid);
      if (paidCents === null) return 'That does not look like an amount.';
      if (paidCents > cents) return 'The amount paid cannot be above the charged amount.';
    }
    if (previewLoading) return 'Checking…';
    if (previewError !== null) return previewError;
    if (preview === null) return '';
    if (!preview.awarded) return cashierMessage(preview.reason ?? 'below_minimum');
    const at = preview.locationName === null ? '' : ` at ${preview.locationName}`;
    const until = preview.expiresAt === null ? '' : `, expiring ${formatDate(preview.expiresAt)}`;
    return `Earns ${preview.points} points${at}${until}.`;
  };

  const nextReward =
    catalog === null || customer === null
      ? null
      : (catalog.find((reward) => reward.pointsCost > customer.balance) ?? null);

  return (
    <main className="till">
      {idleWarn && (
        <p className="idlewarn" role="status">
          Signing out in a minute — touch the screen to stay signed in.
        </p>
      )}
      <header className="topbar">
        <div>
          <p className="brand"><span className="brand-word">OmaPointii</span><span className="brand-tag">Store Portal</span></p>
          <p className="store">
            {membership.storeName}
            <span className="muted">
              {' · '}
              {membership.locationName ??
                (membership.branches.find((branch) => branch.id === branchId)?.name ??
                  (membership.branches.length > 0 ? 'pick a branch' : 'all branches'))}
            </span>
          </p>
        </div>
        <div className="who">
          <span className={connection.online ? 'statuschip' : 'statuschip offline'}>
            <span className="statusdot" aria-hidden="true" />
            {connection.online ? `Online · synced ${connection.time}` : 'Offline · cannot award'}
          </span>
          <span className="muted whoemail">{staffEmail}</span>
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
        {panelMode === 'recorded' && recorded !== null ? (
          <div className="result">
            <div className="resultmark" aria-hidden="true">✓</div>
            <p className="eyebrow">Recorded</p>
            <p className="big">+{recorded.points} points</p>
            <p className="muted">
              New balance: {recorded.balance} points
              {recorded.expiresAt === null ? '' : ` · expires ${formatDate(recorded.expiresAt)}`}
            </p>
            {recorded.redeemed !== null && (
              <p className="muted">
                Redeemed: {recorded.redeemed.name} (−{Math.abs(recorded.redeemed.pointsCost)} pts)
              </p>
            )}
            <button className="primary" type="button" onClick={reset}>
              Next customer
            </button>
          </div>
        ) : panelMode === 'camera' ? (
          <ScanCamera
            initialProblem={cameraInitialProblem}
            onRead={(text) => void handleCameraRead(text)}
            onClose={() => {
              setCameraOpen(false);
              setCameraInitialProblem(null);
            }}
          />
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
                onClick={() => void openCamera()}
                disabled={busy || cameraStarting}
              >
                {cameraStarting ? 'Opening camera…' : 'Scan with camera'}
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
        ) : (
          <div className="customer">
            <p className="eyebrow">Customer</p>
            <p className="big">{customer.firstName || 'New customer'}</p>
            <p className="muted">{customer.balance} points at this store</p>

            {nextReward !== null && (
              <div className="rewardprogress">
                <div
                  className="segbar"
                  role="progressbar"
                  aria-label={`${customer.balance} of ${nextReward.pointsCost} points toward ${nextReward.name}`}
                  aria-valuemin={0}
                  aria-valuemax={nextReward.pointsCost}
                  aria-valuenow={Math.min(customer.balance, nextReward.pointsCost)}
                >
                  {Array.from({ length: 10 }, (_, index) => (
                    <span
                      key={index}
                      className={
                        index <
                        Math.round(
                          Math.min(1, customer.balance / nextReward.pointsCost) * 10,
                        )
                          ? 'on'
                          : ''
                      }
                    />
                  ))}
                </div>
                <p className="muted small">
                  {customer.balance} of {nextReward.pointsCost} · {nextReward.name}
                </p>
              </div>
            )}

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

            {paid === null ? (
              <>
                <label htmlFor="amount">Purchase amount</label>
                <div className="money">
                  <span className="money-euro" aria-hidden="true">€</span>
                  <input
                    id="amount"
                    ref={amountRef}
                    value={amount}
                    onChange={(event) => {
                      setAmount(event.target.value);
                      // Editing the charge restarts the payment step: the
                      // confirmed paid amount would no longer belong to it.
                      if (paid !== null) setPaid(null);
                      // And the checked discount belonged to the old basket.
                      setDiscount(null);
                      setDiscountMsg(null);
                    }}
                    placeholder="12,50"
                    inputMode="decimal"
                    autoComplete="off"
                    autoFocus
                    aria-label="Purchase amount in euros"
                  />
                </div>
              </>
            ) : (
              <>
                <p className="muted">Charged: €{amount.trim()}</p>
                <label htmlFor="paid">Amount paid</label>
                <div className="money">
                  <span className="money-euro" aria-hidden="true">€</span>
                  <input
                    id="paid"
                    value={paid}
                    onChange={(event) => setPaid(event.target.value)}
                    placeholder="12,50"
                    inputMode="decimal"
                    autoComplete="off"
                    autoFocus
                    disabled={busy}
                    aria-label="Amount paid in euros"
                  />
                </div>
                {rewards !== null && rewards.length > 0 && (
                  <div className="rewards">
                    <p className="eyebrow">Use points for a reward</p>
                    <div className="rewardrow">
                      <button
                        type="button"
                        className={selectedReward === null ? 'rewardbtn on' : 'rewardbtn'}
                        onClick={() => setSelectedReward(null)}
                        disabled={busy}
                      >
                        No reward
                      </button>
                      {rewards.map((reward) => (
                        <button
                          key={reward.rewardId}
                          type="button"
                          className={
                            selectedReward?.rewardId === reward.rewardId
                              ? 'rewardbtn on'
                              : 'rewardbtn'
                          }
                          disabled={busy || !reward.affordable}
                          onClick={() =>
                            setSelectedReward({
                              rewardId: reward.rewardId,
                              name: reward.name,
                              pointsCost: reward.pointsCost,
                            })
                          }
                          title={
                            reward.limitReached
                              ? 'Limit reached for today'
                              : reward.affordable
                                ? undefined
                                : 'Not enough points yet'
                          }
                        >
                          {reward.name} · {reward.pointsCost}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            {preview !== null && preview.awarded ? (
              <div className="earn">
                <p className="big">
                  +{preview.points}
                  <span className="earnunit"> pts</span>
                </p>
                <p className="earnsub">
                  on €{(paid ?? amount).trim()}
                  {preview.locationName === null ? '' : ` · at ${preview.locationName}`}
                  {preview.expiresAt === null ? '' : ` · expires ${formatDate(preview.expiresAt)}`}
                </p>
                {selectedReward !== null && preview.redeemed != null && (
                  <p className="earnsub">
                    {preview.redeemed.affordable && !preview.redeemed.limitReached
                      ? `with ${preview.redeemed.name} — ${preview.redeemed.pointsCost} pts`
                      : `${preview.redeemed.name} is not available right now`}
                  </p>
                )}
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
              <p
                className={
                  previewError !== null
                    ? 'preview error'
                    : amount.trim() === ''
                      ? 'preview hint'
                      : 'preview'
                }
              >
                {previewLine()}
              </p>
            )}

            {paid === null && preview !== null && preview.awarded && (
              <div className="discount">
                {discount !== null && cents !== null ? (
                  <p className="muted">
                    Their code takes {formatCents(discount.discountCents)} off — they pay{' '}
                    {formatCents(cents - discount.discountCents)}.
                  </p>
                ) : (
                  <form
                    className="discountcheck"
                    onSubmit={(event) => void handleDiscountVerify(event)}
                  >
                    <label htmlFor="discount-code">Their discount code (optional)</label>
                    <div className="discountrow">
                      <input
                        id="discount-code"
                        value={discountInput}
                        onChange={(event) => setDiscountInput(event.target.value)}
                        placeholder="Scan the rotating code"
                        autoComplete="off"
                        disabled={busy || cents === null}
                      />
                      <button
                        className="ghost"
                        type="submit"
                        disabled={busy || discountInput.trim() === '' || cents === null}
                      >
                        {busy ? 'Checking…' : 'Check'}
                      </button>
                    </div>
                    {discountMsg !== null && <p className="muted">{discountMsg}</p>}
                  </form>
                )}
              </div>
            )}

            <div className="actions">
              {paid === null ? (
                <>
                  <button
                    className="primary"
                    type="button"
                    onClick={() =>
                      setPaid(
                        discount !== null && cents !== null
                          ? formatCents(cents - discount.discountCents)
                          : amount,
                      )
                    }
                    disabled={busy || preview === null || !preview.awarded}
                  >
                    Payment taken
                  </button>
                  <button className="ghost" type="button" onClick={reset} disabled={busy}>
                    Wrong customer
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="primary"
                    type="button"
                    onClick={() => void handleConfirm()}
                    disabled={
                      busy ||
                      preview === null ||
                      !preview.awarded ||
                      (selectedReward !== null &&
                        preview.redeemed != null &&
                        (!preview.redeemed.affordable || preview.redeemed.limitReached))
                    }
                  >
                    {busy
                      ? 'Recording…'
                      : preview !== null && preview.awarded
                        ? `Record +${preview.points} points`
                        : 'Record points'}
                  </button>
                  <button className="ghost" type="button" onClick={() => setPaid(null)} disabled={busy}>
                    Back
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {error !== null && <p className="error">{error}</p>}
        <p className="helpline muted small">
          {HELP_LINE} · OmaPointii {APP_VERSION}
        </p>
      </section>
    </main>
  );
}

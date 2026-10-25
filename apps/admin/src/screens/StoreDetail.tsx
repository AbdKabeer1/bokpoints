import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CreditCard,
  LayoutDashboard,
  ScrollText,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import {
  ApiError,
  getStoreDetail,
  setStoreStatus,
  type StoreDetail,
} from '../api';
import { adminMessage } from '../errors';
import { formatDate, formatDateTime } from '../format';

type DetailTab = 'overview' | 'staff' | 'rules' | 'billing' | 'audit';

const STATUS_PILL: Record<string, string> = {
  active: 'pill active',
  paused: 'pill warn',
  invited: 'pill warn',
  setup: 'pill warn',
  suspended: 'pill danger',
  offboarded: 'pill danger',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  invited: 'Invited',
  setup: 'Setting up',
  suspended: 'Suspended',
  offboarded: 'Offboarded',
};

const roleLabel = (role: string): string =>
  role === 'owner' ? 'Owner' : role === 'manager' ? 'Manager' : role === 'cashier' ? 'Cashier' : role;

const ACTION_LABELS: Record<string, string> = {
  'store.create': 'Store created',
  'store.status': 'Store status changed',
  'store.profile': 'Store profile changed',
  'points.award': 'Points awarded',
  'points.redeem': 'Reward redeemed',
  'points.adjust': 'Points adjusted',
  'points.fraud_clawback': 'Fraud clawback',
  'rule.create': 'Rule created',
  'rule.version': 'Rule changed',
  'rule.status': 'Rule paused or resumed',
  'staff.invite': 'Staff invited',
  'campaign.send': 'Campaign sent',
};

/**
 * One store, as the platform sees it (brief §4.3): the readiness card, the
 * numbers, the people, the billing state and the audited trail — with the
 * one destructive action kept behind a reason.
 */
export function StoreDetailScreen({
  token,
  storeId,
  onBack,
}: {
  token: string;
  storeId: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<StoreDetail | null>(null);
  const [tab, setTab] = useState<DetailTab>('overview');
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'suspended' | 'active' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await getStoreDetail(token, storeId));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? adminMessage(caught.code) : 'The API is not reachable.');
    }
  }, [token, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyStatus = async () => {
    if (confirming === null || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await setStoreStatus(token, storeId, { status: confirming, reason: reason.trim() });
      setFlash(
        confirming === 'suspended'
          ? 'Store suspended. Its till refuses to trade until it is reactivated.'
          : 'Store reactivated. Its till can trade again.',
      );
      setConfirming(null);
      setReason('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? adminMessage(caught.code) : 'Could not change it.');
    } finally {
      setBusy(false);
    }
  };

  if (detail === null) {
    return (
      <section>
        <button className="link iconlink" type="button" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
          Stores
        </button>
        {error !== null ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </section>
    );
  }

  const { store, counts, readiness, staff, recent, subscription } = detail;
  const readinessItems = [
    { done: readiness.owner, label: 'An owner can sign in', detail: 'The store has an active owner.' },
    { done: readiness.rule, label: 'An earning rule is active', detail: 'The till can award points.' },
    { done: readiness.reward, label: 'A reward is available', detail: 'Customers have something to spend on.' },
    { done: readiness.cashier, label: 'A cashier is active', detail: 'Somebody can record a sale.' },
  ];
  const readyCount = readinessItems.filter((item) => item.done).length;
  const readyPercent = Math.round((readyCount / readinessItems.length) * 100);
  const TAB_ICONS = {
    overview: LayoutDashboard,
    staff: Users,
    rules: SlidersHorizontal,
    billing: CreditCard,
    audit: ScrollText,
  } as const;

  return (
    <section>
      <button className="link iconlink" type="button" onClick={onBack} style={{ marginBottom: 14 }}>
        <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
        Stores
      </button>

      <div className="pagehead">
        <div>
          <div className="detailtitle">
            <h1>{store.name}</h1>
            <span className={STATUS_PILL[store.status] ?? 'pill'}>
              <span className="dot" aria-hidden="true" />
              {STATUS_LABEL[store.status] ?? store.status}
            </span>
          </div>
          <p className="sub">
            {store.plan ?? 'Pilot'} · opened {formatDate(store.createdAt.slice(0, 10))} ·{' '}
            {counts.branches === 0 ? 'one counter' : `${counts.branches} branches`}
          </p>
        </div>
        <div className="actions">
          {store.status === 'suspended' ? (
            <button
              className="primary"
              type="button"
              onClick={() => {
                setConfirming('active');
                setFlash(null);
              }}
            >
              Reactivate
            </button>
          ) : (
            <button
              className="ghost danger"
              type="button"
              onClick={() => {
                setConfirming('suspended');
                setFlash(null);
              }}
            >
              Suspend store
            </button>
          )}
        </div>
      </div>

      {error !== null && <p className="error">{error}</p>}
      {flash !== null && <p className="oknote">{flash}</p>}

      <div className="statstrip">
        <div className="stat">
          <p className="statlabel">Customers</p>
          <p className="statvalue">{counts.customers.toLocaleString('fi-FI')}</p>
          <p className="statfoot">{counts.staff} staff with access</p>
        </div>
        <div className="stat">
          <p className="statlabel">Awards · 30 days</p>
          <p className="statvalue">{counts.awards30d.toLocaleString('fi-FI')}</p>
          <p className="statfoot">{counts.redemptions30d} redeemed</p>
        </div>
        <div className="stat">
          <p className="statlabel">Points outstanding</p>
          <p className="statvalue">{counts.outstandingPoints.toLocaleString('fi-FI')}</p>
          <p className="statfoot">Held by this store’s customers</p>
        </div>
        <div className="stat">
          <p className="statlabel">Program</p>
          <p className="statvalue">
            {counts.activeRules} / {counts.activeRewards}
          </p>
          <p className="statfoot">active rules / rewards</p>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Store sections">
        {(
          [
            ['overview', 'Overview', null],
            ['staff', 'Staff', counts.staff],
            ['rules', 'Rules', counts.activeRules],
            ['billing', 'Billing', null],
            ['audit', 'Audit', null],
          ] as [DetailTab, string, number | null][]
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'tab active' : 'tab'}
            onClick={() => setTab(id)}
          >
            {(() => {
              const Icon = TAB_ICONS[id];
              return <Icon size={14} strokeWidth={1.9} aria-hidden="true" />;
            })()}
            {label}
            {count !== null && count > 0 && <span className="count">{count}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid two">
          <div className="grid" style={{ gap: 16 }}>
            <div className="panel readiness">
              <div className="readiness-top">
                <div>
                  <p className="statlabel">Readiness</p>
                  <p className="readiness-value">{readyPercent}%</p>
                  <p className="readiness-caption">
                    {readyCount} of {readinessItems.length} in place
                  </p>
                </div>
                {readyCount < readinessItems.length && (
                  <span className="pill warn">
                    <span className="dot" aria-hidden="true" />
                    Action required
                  </span>
                )}
              </div>

              <div
                className="readiness-bar"
                role="progressbar"
                aria-label="Store readiness"
                aria-valuemin={0}
                aria-valuemax={readinessItems.length}
                aria-valuenow={readyCount}
              >
                {readinessItems.map((item) => (
                  <span key={item.label} className={item.done ? 'on' : ''} />
                ))}
              </div>

              <ul className="checklist">
                {readinessItems.map((item, index) => (
                  <li
                    key={item.label}
                    className={item.done ? 'done' : index === readyCount ? 'doing' : ''}
                  >
                    <span className="state" aria-hidden="true">
                      {item.done ? <Check size={12} strokeWidth={2.4} /> : ''}
                    </span>
                    <span className="txt">
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="panel">
              <div className="panelhead">
                <div>
                  <h3>Recent activity</h3>
                  <p className="sub">The last ten audited actions at this store</p>
                </div>
              </div>
              {recent.length === 0 ? (
                <p className="emptynote">Nothing recorded yet.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>What</th>
                      <th>By</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.slice(0, 6).map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <strong style={{ fontWeight: 600 }}>
                            {ACTION_LABELS[entry.action] ?? entry.action}
                          </strong>
                          {entry.reason !== null && (
                            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                              {entry.reason}
                            </div>
                          )}
                        </td>
                        <td className="muted">{entry.actorEmail ?? 'system'}</td>
                        <td className="mono">{formatDateTime(entry.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="grid" style={{ gap: 16 }}>
            <div className="panel">
              <div className="panelhead">
                <div>
                  <h3>Details</h3>
                  <p className="sub">What the store entered about itself</p>
                </div>
              </div>
              <dl className="kv">
                <div>
                  <dt>Address</dt>
                  <dd>{store.address ?? 'Not given'}</dd>
                </div>
                <div>
                  <dt>Contact</dt>
                  <dd>{store.contactName ?? 'Not given'}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{store.contactEmail ?? 'Not given'}</dd>
                </div>
                <div>
                  <dt>Brand colour</dt>
                  <dd>
                    {store.brandColor === null ? (
                      'OmaPointii green'
                    ) : (
                      <span className="colourvalue">
                        <span
                          className="swatchdot"
                          style={{ backgroundColor: store.brandColor }}
                          aria-hidden="true"
                        />
                        {store.brandColor}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Per-sale ceiling</dt>
                  <dd>
                    {store.maxPointsPerSale === null
                      ? 'Platform default'
                      : `${store.maxPointsPerSale} points`}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="panel">
              <div className="panelhead">
                <div>
                  <h3>Subscription</h3>
                  <p className="sub">Billing is not connected yet</p>
                </div>
              </div>
              {subscription === null ? (
                <p className="muted" style={{ fontSize: 13 }}>
                  No subscription row. This store runs on the pilot arrangement with OmaPointii.
                </p>
              ) : (
                <dl className="kv">
                  <div>
                    <dt>Plan</dt>
                    <dd>{subscription.plan}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{subscription.status}</dd>
                  </div>
                  <div>
                    <dt>Renews</dt>
                    <dd>
                      {subscription.currentPeriodEnd === null
                        ? 'Not set'
                        : formatDate(subscription.currentPeriodEnd.slice(0, 10))}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'staff' && (
        <div className="panel" style={{ padding: 0 }}>
          {staff.length === 0 ? (
            <p className="emptynote" style={{ margin: 16 }}>
              Nobody has access to this store.
            </p>
          ) : (
            <table className="table" style={{ border: 'none' }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Branch</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((member) => (
                  <tr key={member.memberId}>
                    <td>
                      <span className="person">
                        <span className="avatar" aria-hidden="true">
                          {member.name
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((part) => part[0]?.toUpperCase() ?? '')
                            .join('')}
                        </span>
                        {member.name}
                      </span>
                    </td>
                    <td className="muted">{member.email}</td>
                    <td>{roleLabel(member.role)}</td>
                    <td className="muted">{member.locationName ?? 'Every branch'}</td>
                    <td>
                      <span className={member.status === 'active' ? 'pill active' : 'pill warn'}>
                        <span className="dot" aria-hidden="true" />
                        {member.status === 'active' ? 'Active' : 'Invited'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'rules' && (
        <div className="grid two">
          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>Program</h3>
                <p className="sub">Counts only: the rule text belongs to the store</p>
              </div>
            </div>
            <dl className="kv">
              <div>
                <dt>Active earning rules</dt>
                <dd>{counts.activeRules}</dd>
              </div>
              <div>
                <dt>Active rewards</dt>
                <dd>{counts.activeRewards}</dd>
              </div>
              <div>
                <dt>Branches</dt>
                <dd>{counts.branches === 0 ? 'One counter' : counts.branches}</dd>
              </div>
            </dl>
          </div>
          <div className="panel tint">
            <div className="panelhead">
              <div>
                <h3>Why counts, not contents</h3>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
              A store’s rules and rewards are its commercial terms. Support reads how many are
              running, and the store’s own portal shows the text. Opening the text from here would
              need a deliberate support-view decision and an audit entry of its own.
            </p>
          </div>
        </div>
      )}

      {tab === 'billing' && (
        <div className="grid two">
          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>Subscription</h3>
                <p className="sub">Plan, payment stage and renewal</p>
              </div>
            </div>
            {subscription === null ? (
              <p className="muted" style={{ fontSize: 13 }}>
                No billing row yet. Billing arrives with the payment provider; until then every
                pilot store is on a direct arrangement.
              </p>
            ) : (
              <dl className="kv">
                <div>
                  <dt>Plan</dt>
                  <dd>{subscription.plan}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{subscription.status}</dd>
                </div>
                <div>
                  <dt>Renews</dt>
                  <dd>
                    {subscription.currentPeriodEnd === null
                      ? 'Not set'
                      : formatDate(subscription.currentPeriodEnd.slice(0, 10))}
                  </dd>
                </div>
              </dl>
            )}
          </div>
          <div className="panel tint">
            <div className="panelhead">
              <div>
                <h3>Not connected</h3>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
              Payment method, invoices and the failed-payment stages need the payment provider.
              Nothing here pretends otherwise.
            </p>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="panel" style={{ padding: 0 }}>
          {recent.length === 0 ? (
            <p className="emptynote" style={{ margin: 16 }}>
              Nothing recorded yet.
            </p>
          ) : (
            <table className="table" style={{ border: 'none' }}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>By</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((entry) => (
                  <tr key={entry.id}>
                    <td className="mono">{formatDateTime(entry.createdAt)}</td>
                    <td>
                      <code className="actioncode">{entry.action}</code>
                    </td>
                    <td className="muted">{entry.actorEmail ?? 'system'}</td>
                    <td>{entry.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ fontSize: 12, margin: 16 }}>
            The platform-wide log, with filters, is under Audit log in the sidebar.
          </p>
        </div>
      )}

      {confirming !== null && (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="status-dialog-title"
          >
            <h3 id="status-dialog-title">
              {confirming === 'suspended' ? 'Suspend this store?' : 'Reactivate this store?'}
            </h3>
            <p className="muted" style={{ fontSize: 13 }}>
              {confirming === 'suspended'
                ? 'Its till will refuse to award points or take a reward until it is reactivated. Existing balances are untouched.'
                : 'The till can trade again immediately.'}
            </p>
            <label htmlFor="status-reason">Reason (recorded in the audit log)</label>
            <textarea
              id="status-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                confirming === 'suspended'
                  ? 'Failed payment for 30 days'
                  : 'Payment settled, store cleared'
              }
            />
            <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  setConfirming(null);
                  setReason('');
                }}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className={confirming === 'suspended' ? 'dangerbtn' : 'primary'}
                type="button"
                onClick={() => void applyStatus()}
                disabled={busy || reason.trim().length < 3}
              >
                {busy
                  ? 'Saving…'
                  : confirming === 'suspended'
                    ? 'Suspend store'
                    : 'Reactivate store'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

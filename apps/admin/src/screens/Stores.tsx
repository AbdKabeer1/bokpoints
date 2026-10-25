import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Coins, Gift, Store, Users } from 'lucide-react';
import { ApiError, getAnalytics, listStores, type Analytics, type StoreRow } from '../api';
import { adminMessage } from '../errors';
import { formatDate, formatDateTime } from '../format';

const STATUSES = ['all', 'active', 'paused', 'suspended'] as const;
type StatusFilter = (typeof STATUSES)[number];

const statusPill = (status: string): string => {
  if (status === 'active') return 'pill active';
  if (status === 'paused' || status === 'invited' || status === 'setup') return 'pill warn';
  if (status === 'suspended' || status === 'offboarded') return 'pill danger';
  return 'pill';
};

const statusLabel = (status: string): string => {
  if (status === 'active') return 'Active';
  if (status === 'paused') return 'Paused';
  if (status === 'suspended') return 'Suspended';
  if (status === 'invited') return 'Invited';
  if (status === 'setup') return 'Setting up';
  if (status === 'offboarded') return 'Offboarded';
  return status;
};

/**
 * The platform's front page: every store, its state, its size and when it
 * last traded — plus the four numbers that describe the business.
 */
export function StoresScreen({
  token,
  onOpenStore,
}: {
  token: string;
  onOpenStore: (storeId: string) => void;
}) {
  const [stores, setStores] = useState<StoreRow[] | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, stats] = await Promise.all([
        listStores(token, {
          status: filter === 'all' ? undefined : filter,
          query: applied === '' ? undefined : applied,
        }),
        getAnalytics(token),
      ]);
      setStores(list.stores);
      setAnalytics(stats);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? adminMessage(caught.code) : 'The API is not reachable.');
    } finally {
      setLoading(false);
    }
  }, [token, filter, applied]);

  useEffect(() => {
    void load();
  }, [load]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    setApplied(query.trim());
  };

  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Stores</h1>
          <p className="sub">
            {stores === null
              ? 'Loading…'
              : `${stores.length} store${stores.length === 1 ? '' : 's'}${
                  filter === 'all' ? '' : ` · ${filter}`
                }${applied === '' ? '' : ` · “${applied}”`}`}
          </p>
        </div>
        <div className="actions">
          <button className="ghost" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error !== null && <p className="error">{error}</p>}

      {analytics !== null && (
        <div className="statstrip">
          <div className="stat">
            <div className="statlabel-row">
              <span className="staticon" aria-hidden="true"><Store size={13} strokeWidth={2} /></span>
              <p className="statlabel">Stores</p>
            </div>
            <p className="statvalue">{analytics.stores.toLocaleString('fi-FI')}</p>
            <p className="statfoot">{analytics.activeStores} active</p>
          </div>
          <div className="stat">
            <div className="statlabel-row">
              <span className="staticon" aria-hidden="true"><Users size={13} strokeWidth={2} /></span>
              <p className="statlabel">Customers</p>
            </div>
            <p className="statvalue">{analytics.customers.toLocaleString('fi-FI')}</p>
            <p className="statfoot">Across every store</p>
          </div>
          <div className="stat">
            <div className="statlabel-row">
              <span className="staticon" aria-hidden="true"><Gift size={13} strokeWidth={2} /></span>
              <p className="statlabel">Awards · 30 days</p>
            </div>
            <p className="statvalue">{analytics.awards30d.toLocaleString('fi-FI')}</p>
            <p className="statfoot">{analytics.redemptions30d} redeemed</p>
          </div>
          <div className="stat">
            <div className="statlabel-row">
              <span className="staticon" aria-hidden="true"><Coins size={13} strokeWidth={2} /></span>
              <p className="statlabel">Points outstanding</p>
            </div>
            <p className="statvalue">{analytics.outstandingPoints.toLocaleString('fi-FI')}</p>
            <p className="statfoot">A liability, not yet spent</p>
          </div>
        </div>
      )}

      <div className="filterrow">
        <div className="segmented" role="group" aria-label="Filter by status">
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={filter === status ? 'on' : ''}
              aria-pressed={filter === status}
              onClick={() => setFilter(status)}
            >
              {status === 'all' ? 'All' : statusLabel(status)}
            </button>
          ))}
        </div>

        <form className="searchrow" onSubmit={search}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Store name…"
            aria-label="Search stores by name"
          />
          <button className="ghost" type="submit">
            Search
          </button>
          {applied !== '' && (
            <button
              className="link"
              type="button"
              onClick={() => {
                setQuery('');
                setApplied('');
              }}
            >
              Clear
            </button>
          )}
        </form>
      </div>

      {stores !== null && stores.length === 0 && (
        <p className="emptynote">
          {applied === '' && filter === 'all'
            ? 'No stores yet. Creating a store runs through the onboarding API until the owner-invite flow ships.'
            : 'No store matches that filter.'}
        </p>
      )}

      {stores !== null && stores.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Store</th>
              <th>Plan</th>
              <th>Status</th>
              <th className="num">Customers</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((store) => (
              <tr key={store.storeId}>
                <td>
                  <button
                    type="button"
                    className="link strong"
                    onClick={() => onOpenStore(store.storeId)}
                  >
                    {store.name}
                  </button>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                    since {formatDate(store.createdAt.slice(0, 10))}
                  </div>
                </td>
                <td className="muted">{store.plan ?? 'Pilot'}</td>
                <td>
                  <span className={statusPill(store.status)}>
                    <span className="dot" aria-hidden="true" />
                    {statusLabel(store.status)}
                  </span>
                </td>
                <td className="num">{store.customers.toLocaleString('fi-FI')}</td>
                <td className="mono">
                  {store.lastActivityAt === null ? 'Never' : formatDateTime(store.lastActivityAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
        Opening a store shows its subscription, staff, readiness and audit trail. Creating a
        store needs the owner’s sign-in account, so it stays on the onboarding API until the
        invitation flow is connected.
      </p>
    </section>
  );
}

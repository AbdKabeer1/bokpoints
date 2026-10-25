import { useCallback, useEffect, useState } from 'react';
import { ApiError, listSubscriptions, type Subscription } from '../api';
import { adminMessage } from '../errors';
import { formatDate } from '../format';

/**
 * Plans and payment state. Billing is not connected yet, so the honest
 * empty state explains what will be here rather than showing fake rows.
 */
export function SubscriptionsScreen({ token }: { token: string }) {
  const [rows, setRows] = useState<Subscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await listSubscriptions(token)).subscriptions);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? adminMessage(caught.code) : 'The API is not reachable.');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const failed = (rows ?? []).filter(
    (row) => row.status === 'past_due' || row.status === 'paused' || row.status === 'suspended',
  ).length;

  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Subscriptions</h1>
          <p className="sub">
            {rows === null
              ? 'Loading…'
              : `${rows.length} subscription${rows.length === 1 ? '' : 's'}${
                  failed === 0 ? '' : ` · ${failed} needing attention`
                }`}
          </p>
        </div>
      </div>

      {error !== null && <p className="error">{error}</p>}

      {failed > 0 && (
        <div className="callout danger">
          <span className="ico" aria-hidden="true">
            !
          </span>
          <p>
            {failed} subscription{failed === 1 ? ' is' : 's are'} past due or paused. The reminder,
            pause and suspend stages are defined; acting on them arrives with billing.
          </p>
        </div>
      )}

      {rows !== null && rows.length === 0 ? (
        <div className="grid two">
          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>No subscriptions yet</h3>
                <p className="sub">Billing is not connected</p>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              Every pilot store runs on a direct arrangement with OmaPointii. When the payment provider
              is connected, this table will show each store’s plan, payment status and renewal date.
            </p>
            <div className="placeholdercard" style={{ marginTop: 12, marginBottom: 0 }}>
              <strong>What will appear</strong>
              <p>
                Plan, amount, renewal, failed-payment stage (reminder, paused, suspended) and a link
                to the payment provider.
              </p>
            </div>
          </div>
          <div className="panel tint">
            <div className="panelhead">
              <div>
                <h3>Why it is empty</h3>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
              A subscription row exists only after the provider creates one. Showing invented rows
              would make the platform look further along than it is.
            </p>
          </div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Store</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Renews</th>
              <th>Failed since</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row) => (
              <tr key={row.storeId}>
                <td>{row.storeName}</td>
                <td className="muted">{row.plan}</td>
                <td>
                  <span
                    className={
                      row.status === 'active'
                        ? 'pill active'
                        : row.status === 'trialing'
                          ? 'pill info'
                          : 'pill danger'
                    }
                  >
                    <span className="dot" aria-hidden="true" />
                    {row.status}
                  </span>
                </td>
                <td className="mono">
                  {row.currentPeriodEnd === null
                    ? 'Not set'
                    : formatDate(row.currentPeriodEnd.slice(0, 10))}
                </td>
                <td className="mono">
                  {row.firstFailedPaymentAt === null
                    ? '—'
                    : formatDate(row.firstFailedPaymentAt.slice(0, 10))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
        The failed-payment schedule — reminder on day 7, paused on day 14, suspended on day 30 —
        is defined in the product; none of it can run before a provider is connected.
      </p>
    </section>
  );
}

import { useState, type FormEvent } from 'react';
import { ApiError, searchSupport, type SupportResults } from '../api';
import { adminMessage } from '../errors';
import { formatDate } from '../format';
import { FeedbackForm, RecentFeedback } from '../components/FeedbackPanel';

/**
 * One search box for support: a store name, or a customer's email, name or
 * code. Read-only; the destructive actions live under Safety.
 */
export function SupportScreen({
  token,
  onOpenStore,
}: {
  token: string;
  onOpenStore: (storeId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SupportResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await searchSupport(token, query.trim()));
    } catch (caught) {
      setError(caught instanceof ApiError ? adminMessage(caught.code) : 'The API is not reachable.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Support</h1>
          <p className="sub">Find a store or a customer without leaving the platform</p>
        </div>
      </div>

      <form className="searchrow" onSubmit={(event) => void search(event)}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Store name, customer email, name or code…"
          aria-label="Search stores and customers"
          style={{ maxWidth: 420 }}
        />
        <button className="primary" type="submit" disabled={busy || query.trim().length < 2}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error !== null && <p className="error">{error}</p>}

      {results === null ? (
        <div className="panel">
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Type at least two characters. A customer search matches the email, the name or the
            printed OmaPointii code, and shows their balance at each store.
          </p>
        </div>
      ) : results.stores.length === 0 && results.customers.length === 0 ? (
        <p className="emptynote">Nothing matches “{query.trim()}”.</p>
      ) : (
        <div className="grid two">
          <div className="grid" style={{ gap: 16 }}>
            <div className="panel">
              <div className="panelhead">
                <div>
                  <h3>Stores</h3>
                  <p className="sub">{results.stores.length} matching</p>
                </div>
              </div>
              {results.stores.length === 0 ? (
                <p className="emptynote">No store matches.</p>
              ) : (
                <div className="grid" style={{ gap: 6 }}>
                  {results.stores.map((store) => (
                    <button
                      key={store.storeId}
                      type="button"
                      className="ghost"
                      style={{ justifyContent: 'space-between', display: 'flex' }}
                      onClick={() => onOpenStore(store.storeId)}
                    >
                      <span>{store.name}</span>
                      <span className="muted">{store.status}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="panel">
              <div className="panelhead">
                <div>
                  <h3>Customers</h3>
                  <p className="sub">{results.customers.length} matching</p>
                </div>
              </div>
              {results.customers.length === 0 ? (
                <p className="emptynote">No customer matches.</p>
              ) : (
                <div className="grid" style={{ gap: 12 }}>
                  {results.customers.map((customer) => (
                    <div key={customer.customerId} className="supportcustomer">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong>{customer.name === '' ? customer.email : customer.name}</strong>
                        <span>
                          {customer.email} · since {formatDate(customer.createdAt.slice(0, 10))}
                        </span>
                      </div>
                      <div className="balances">
                        {customer.balances.length === 0 ? (
                          <span className="muted">No balance anywhere</span>
                        ) : (
                          customer.balances.map((balance) => (
                            <button
                              key={balance.storeId}
                              type="button"
                              className="balancechip"
                              onClick={() => onOpenStore(balance.storeId)}
                              title={`Open ${balance.storeName}`}
                            >
                              {balance.storeName}
                              <strong>{balance.balance.toLocaleString('fi-FI')}</strong>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="panel tint">
            <div className="panelhead">
              <div>
                <h3>Read-only by default</h3>
                <p className="sub">Support looks; Safety acts</p>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
              This view is deliberately read-only. Clawbacks, account anonymisation and campaign
              removal sit under Safety, each with a reason and an audit entry.
            </p>
          </div>
        </div>
      )}
      <div className="grid two" style={{ marginTop: 16 }}>
        <FeedbackForm token={token} />
        <RecentFeedback token={token} />
      </div>

    </section>
  );
}

import { useState, type FormEvent } from 'react';
import {
  ApiError,
  anonymiseCustomerAsAdmin,
  searchSupport,
  type SupportResults,
} from '../api';
import { adminMessage } from '../errors';

type Customer = SupportResults['customers'][number];

/**
 * The safety surface. The only destructive action with real data behind it
 * today is customer anonymisation (A5); abuse flags still have no source, so
 * that panel stays honest.
 */
export function SafetyScreen({ token }: { token: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SupportResults | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setResults(await searchSupport(token, query.trim()));
    } catch (caught) {
      setError(caught instanceof ApiError ? adminMessage(caught.code) : 'The API is not reachable.');
    } finally {
      setBusy(false);
    }
  };

  const anonymise = async (event: FormEvent) => {
    event.preventDefault();
    if (selected === null) return;
    if (confirmation !== 'ANONYMISE') {
      setError('Type ANONYMISE exactly to confirm.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Give a reason for the audit log.');
      return;
    }

    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await anonymiseCustomerAsAdmin(token, selected.customerId, {
        reason: reason.trim(),
        confirmation: 'ANONYMISE',
      });
      setDone(`${selected.email} was anonymised. The ledger totals were kept.`);
      setSelected(null);
      setReason('');
      setConfirmation('');
      setResults(null);
      setQuery('');
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
          <h1>Safety</h1>
          <p className="sub">Abuse, anonymisation and campaign takedowns</p>
        </div>
      </div>

      {error !== null && <p className="error">{error}</p>}
      {done !== null && <p className="saved">{done}</p>}

      <div className="grid two">
        <div className="panel">
          <div className="panelhead">
            <div>
              <h3>Open flags</h3>
              <p className="sub">Nothing to review</p>
            </div>
            <span className="pill active">
              <span className="dot" aria-hidden="true" />
              Clear
            </span>
          </div>
          <p className="emptynote">
            No flag source is connected yet. When store reports and fraud signals exist, each case
            lands here with the store, the customer and the evidence.
          </p>
        </div>

        <div className="panel">
          <div className="panelhead">
            <div>
              <h3>Anonymise a customer</h3>
              <p className="sub">Keeps ledger totals; removes identity</p>
            </div>
          </div>

          <form className="searchrow" onSubmit={(event) => void search(event)}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Customer email, name or code…"
              aria-label="Find a customer to anonymise"
              style={{ maxWidth: 360 }}
            />
            <button className="primary" type="submit" disabled={busy || query.trim().length < 2}>
              {busy ? 'Searching…' : 'Find'}
            </button>
          </form>

          {results !== null && (
            <div className="grid" style={{ gap: 8, marginTop: 14 }}>
              {results.customers.length === 0 ? (
                <p className="emptynote">No customer matches.</p>
              ) : (
                results.customers.map((customer) => (
                  <button
                    key={customer.customerId}
                    type="button"
                    className="ghost"
                    style={{ justifyContent: 'space-between', display: 'flex' }}
                    onClick={() => {
                      setSelected(customer);
                      setReason('');
                      setConfirmation('');
                      setError(null);
                      setDone(null);
                    }}
                  >
                    <span>{customer.name === '' ? customer.email : customer.name}</span>
                    <span className="muted">{customer.email}</span>
                  </button>
                ))
              )}
            </div>
          )}

          {selected !== null && (
            <form onSubmit={(event) => void anonymise(event)} style={{ marginTop: 16 }}>
              <p className="muted" style={{ fontSize: 13 }}>
                {selected.name === '' ? selected.email : selected.name} · {selected.email}
              </p>
              <p className="emptynote">
                The name, email, phone, QR codes and store consents are removed. Points entries
                stay so each store&apos;s totals do not change. This cannot be undone.
              </p>

              <label>
                Reason (audit log)
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why this account is being anonymised"
                  maxLength={500}
                />
              </label>
              <label>
                Type ANONYMISE to confirm
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder="ANONYMISE"
                  autoComplete="off"
                />
              </label>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  className="primary"
                  type="submit"
                  disabled={busy || confirmation !== 'ANONYMISE' || reason.trim().length < 3}
                >
                  {busy ? 'Anonymising…' : 'Anonymise customer'}
                </button>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setReason('');
                    setConfirmation('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

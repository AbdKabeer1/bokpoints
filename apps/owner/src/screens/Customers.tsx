import { useCallback, useEffect, useState } from 'react';
import {
  adjustPoints,
  ApiError,
  listCustomers,
  registerCustomer,
  type RuleCustomer,
} from '../api';
import { ownerMessage } from '../errors';
import { CustomerDetail } from './CustomerDetail';
import { isEmail } from '../format';

export function CustomersScreen({ token, storeId }: { token: string; storeId: string }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<RuleCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);

  const load = useCallback(
    async (search: string) => {
      try {
        setRows((await listCustomers(token, storeId, search === '' ? undefined : search)).customers);
        setError(null);
      } catch (caught) {
        setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'The API is not reachable.');
      }
    },
    [token, storeId],
  );

  useEffect(() => {
    void load('');
  }, [load]);

  return (
    <section>
      <div className="sectionhead">
        <h2>Customers</h2>
        {registerOpen ? (
          <button className="ghost" type="button" onClick={() => setRegisterOpen(false)}>
            Close
          </button>
        ) : (
          <button className="primary" type="button" onClick={() => setRegisterOpen(true)}>
            Register a customer
          </button>
        )}
      </div>

      {error !== null && <p className="error">{error}</p>}
      {flash !== null && <p className="oknote">{flash}</p>}

      {registerOpen && (
        <RegisterForm
          token={token}
          storeId={storeId}
          onDone={(message) => {
            setRegisterOpen(false);
            setFlash(message);
            void load(query);
          }}
        />
      )}

      <form
        className="searchrow"
        onSubmit={(event) => {
          event.preventDefault();
          void load(query.trim());
        }}
      >
        <input
          aria-label="Search customers"
          placeholder="Search by name or email…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="ghost" type="submit">
          Search
        </button>
        {query !== '' && (
          <button
            className="ghost"
            type="button"
            onClick={() => {
              setQuery('');
              void load('');
            }}
          >
            Clear
          </button>
        )}
      </form>

      {rows !== null && rows.length === 0 && (
        <p className="emptynote">
          {query === ''
            ? 'No customers yet. Register the first one above.'
            : 'Nobody matches that search.'}
        </p>
      )}

      {rows !== null && rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Points</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((customer) =>
              adjustingId === customer.customerId ? (
                <tr key={customer.customerId} className="formrow">
                  <td colSpan={5}>
                    <AdjustForm
                      customer={customer}
                      token={token}
                      storeId={storeId}
                      onClose={() => setAdjustingId(null)}
                      onDone={(message, balance) => {
                        setAdjustingId(null);
                        setFlash(message);
                        setRows(
                          rows.map((row) =>
                            row.customerId === customer.customerId
                              ? { ...row, balance }
                              : row,
                          ),
                        );
                      }}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={customer.customerId}>
                  <td>{customer.name}</td>
                  <td className="muted">{customer.email}</td>
                  <td>{customer.balance}</td>
                  <td>
                    {customer.pending ? (
                      <span className="chip pending">Not joined yet</span>
                    ) : (
                      <span className="chip active">Member</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => {
                        setAdjustingId(null);
                        setHistoryId(historyId === customer.customerId ? null : customer.customerId);
                      }}
                    >
                      History
                    </button>{' '}
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => {
                        setHistoryId(null);
                        setAdjustingId(customer.customerId);
                      }}
                    >
                      Adjust points
                    </button>
                  </td>
                </tr>
              ),
            )}
            {historyId !== null &&
              (() => {
                const customer = rows.find((row) => row.customerId === historyId);
                if (customer === undefined) return null;
                return (
                  <tr className="formrow">
                    <td colSpan={5}>
                      <CustomerDetail
                        name={customer.name}
                        customerId={customer.customerId}
                        token={token}
                        storeId={storeId}
                        onClose={() => setHistoryId(null)}
                      />
                    </td>
                  </tr>
                );
              })()}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * Manual corrections only, with a reason that lands in the audit log. Points
 * from purchases never come through here.
 */
function AdjustForm({
  customer,
  token,
  storeId,
  onClose,
  onDone,
}: {
  customer: RuleCustomer;
  token: string;
  storeId: string;
  onClose: () => void;
  onDone: (message: string, balance: number) => void;
}) {
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const value = /^-?\d{1,6}$/.test(points.trim()) ? Number(points) : NaN;
    if (!Number.isInteger(value) || value === 0) {
      setProblem('Type a whole number, like 10 or -5, never zero.');
      return;
    }
    if (reason.trim().length < 3) {
      setProblem('Write a short reason (it goes into the audit log).');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await adjustPoints(token, storeId, customer.customerId, {
        points: value,
        reason: reason.trim(),
      });
      onDone(
        `${value > 0 ? '+' : ''}${value} points for ${customer.name} — balance now ${result.balance}.`,
        result.balance,
      );
    } catch (caught) {
      setProblem(caught instanceof ApiError ? ownerMessage(caught.code) : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inlineform">
      <div className="tryrow">
        <div className="tryfield">
          <label htmlFor="adjust-points">
            Points for {customer.name} (balance {customer.balance}; use − to take away)
          </label>
          <input
            id="adjust-points"
            value={points}
            onChange={(event) => setPoints(event.target.value)}
            placeholder="10"
            inputMode="numeric"
          />
        </div>
        <div className="tryfield grow">
          <label htmlFor="adjust-reason">Reason (audit log)</label>
          <input
            id="adjust-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Goodwill for a missed stamp"
          />
        </div>
      </div>
      {problem !== null && <p className="error">{problem}</p>}
      <div className="actions">
        <button className="primary" type="button" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Apply'}
        </button>
        <button className="ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Registering without the app: the customer is created now and marked
 * pending; they join with the app (or a card) whenever, same record.
 */
function RegisterForm({
  token,
  storeId,
  onDone,
}: {
  token: string;
  storeId: string;
  onDone: (message: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!isEmail(email)) {
      setProblem('Type a valid email address.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const registered = await registerCustomer(token, storeId, {
        email: email.trim(),
        ...(name.trim() === '' ? {} : { name: name.trim() }),
      });
      onDone(
        `${registered.email} registered${registered.pending ? ' — they are not joined yet; the account activates when they sign in or get a card' : ''}.`,
      );
    } catch (caught) {
      setProblem(caught instanceof ApiError ? ownerMessage(caught.code) : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card editor"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3>Register a customer</h3>
      <div className="tryrow">
        <div className="tryfield grow">
          <label htmlFor="reg-email">Email</label>
          <input
            id="reg-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="tryfield grow">
          <label htmlFor="reg-name">Name</label>
          <input
            id="reg-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Kai Korhonen"
          />
        </div>
      </div>
      {problem !== null && <p className="error">{problem}</p>}
      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Registering…' : 'Register'}
        </button>
      </div>
    </form>
  );
}

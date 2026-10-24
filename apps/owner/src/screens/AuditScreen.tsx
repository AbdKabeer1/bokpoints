import { useCallback, useEffect, useState } from 'react';
import { ApiError, listAudit, type AuditEntry } from '../api';
import { ownerMessage } from '../errors';
import { formatTimestamp } from '../format';

/** The audit actions this store makes, so the filter box has a menu. */
const COMMON_ACTIONS = ['', 'rule.create', 'rule.version', 'rule.status', 'adjustment', 'staff.invite'];

export function AuditScreen({ token, storeId }: { token: string; storeId: string }) {
  const [action, setAction] = useState('');
  const [limit, setLimit] = useState('50');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (ofAction: string, withLimit: string) => {
      try {
        setEntries(
          (await listAudit(token, storeId, withLimit, ofAction === '' ? undefined : ofAction)).entries,
        );
        setError(null);
      } catch (caught) {
        setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'The API is not reachable.');
      }
    },
    [token, storeId],
  );

  useEffect(() => {
    void load(action, limit);
  }, [load, action, limit]);

  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Audit log</h1>
          <p className="muted">What was done, by whom, and why — newest first.</p>
        </div>
      </div>

      <form
        className="searchrow"
        onSubmit={(event) => {
          event.preventDefault();
          void load(action, limit);
        }}
      >
        <label className="muted" htmlFor="audit-action">
          Action
        </label>
        <select
          id="audit-action"
          value={action}
          onChange={(event) => setAction(event.target.value)}
        >
          {COMMON_ACTIONS.map((entry) => (
            <option key={entry} value={entry}>
              {entry === '' ? 'All actions' : entry}
            </option>
          ))}
        </select>
        <label className="muted" htmlFor="audit-limit">
          Show
        </label>
        <select
          id="audit-limit"
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
        >
          <option value="25">Last 25</option>
          <option value="50">Last 50</option>
          <option value="100">Last 100</option>
        </select>
        <button className="ghost" type="submit">
          Refresh
        </button>
      </form>

      {error !== null && <p className="error">{error}</p>}

      {entries !== null && entries.length === 0 && <p className="emptynote">Nothing yet.</p>}

      {entries !== null && entries.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>When (UTC)</th>
              <th>Action</th>
              <th>By</th>
              <th>Target</th>
              <th>Reason</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="muted">{formatTimestamp(entry.createdAt)}</td>
                <td>
                  <code className="actioncode">{entry.action}</code>
                </td>
                <td className="muted">{entry.actorEmail ?? 'system'}</td>
                <td className="muted">
                  {entry.targetType === null ? '—' : `${entry.targetType}`}
                </td>
                <td>{entry.reason ?? ''}</td>
                <td>
                  {entry.before === null && entry.after === null ? (
                    '—'
                  ) : (
                    <details>
                      <summary>Show</summary>
                      <pre className="detail">
                        {JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}
                      </pre>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

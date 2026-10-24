import { useCallback, useEffect, useState } from 'react';
import { ApiError, listAudit, type AuditEntry } from '../api';
import { adminMessage } from '../errors';
import { formatDateTime } from '../format';

const ACTIONS = [
  '',
  'store.create',
  'store.status',
  'store.profile',
  'staff.invite',
  'rule.create',
  'rule.version',
  'rule.status',
  'points.adjust',
  'points.fraud_clawback',
  'campaign.send',
];

/** Every admin and store action, newest first. */
export function AuditScreen({ token }: { token: string }) {
  const [action, setAction] = useState('');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(
        (await listAudit(token, { limit: '100', action: action === '' ? undefined : action }))
          .entries,
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? adminMessage(caught.code) : 'The API is not reachable.');
    }
  }, [token, action]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Audit log</h1>
          <p className="sub">Every platform and store action, newest first</p>
        </div>
      </div>

      <div className="filterrow">
        <div className="segmented" role="group" aria-label="Filter by action">
          <button
            type="button"
            className={action === '' ? 'on' : ''}
            aria-pressed={action === ''}
            onClick={() => setAction('')}
          >
            All
          </button>
          <button
            type="button"
            className={action === 'points.fraud_clawback' ? 'on' : ''}
            aria-pressed={action === 'points.fraud_clawback'}
            onClick={() => setAction('points.fraud_clawback')}
          >
            Clawbacks
          </button>
          <button
            type="button"
            className={action === 'store.status' ? 'on' : ''}
            aria-pressed={action === 'store.status'}
            onClick={() => setAction('store.status')}
          >
            Store status
          </button>
        </div>

        <form
          className="searchrow"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
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
            {ACTIONS.map((entry) => (
              <option key={entry} value={entry}>
                {entry === '' ? 'All actions' : entry}
              </option>
            ))}
          </select>
          <button className="ghost" type="submit">
            Refresh
          </button>
        </form>
      </div>

      {error !== null && <p className="error">{error}</p>}

      {entries !== null && entries.length === 0 && <p className="emptynote">Nothing yet.</p>}

      {entries !== null && entries.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
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
                <td className="mono">{formatDateTime(entry.createdAt)}</td>
                <td>
                  <code className="actioncode">{entry.action}</code>
                </td>
                <td className="muted">{entry.actorEmail ?? 'system'}</td>
                <td className="muted">{entry.targetType ?? '—'}</td>
                <td>{entry.reason ?? '—'}</td>
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

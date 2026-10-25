import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, listFeedback, sendFeedback } from '../api';

export function FeedbackForm({ token }: { token: string }) {
  const [category, setCategory] = useState<'bug' | 'idea' | 'other'>('idea');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (message.trim().length < 3) {
      setError('Write a little more first.');
      return;
    }
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      await sendFeedback(token, { category, message: message.trim(), page: 'Support' });
      setSent(true);
      setMessage('');
    } catch (caught) {
      setError(caught instanceof ApiError ? 'We could not send that.' : 'The API is not reachable.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panelhead">
        <div>
          <h3>Send feedback</h3>
          <p className="sub">A bug, an idea, or something that reads wrong</p>
        </div>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="admin-feedback-category">Kind of feedback</label>
        <select
          id="admin-feedback-category"
          value={category}
          onChange={(event) => setCategory(event.target.value as 'bug' | 'idea' | 'other')}
        >
          <option value="bug">Problem</option>
          <option value="idea">Idea</option>
          <option value="other">Other</option>
        </select>

        <label htmlFor="admin-feedback-message">Message</label>
        <textarea
          id="admin-feedback-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="What happened, or what would help?"
          maxLength={2000}
          rows={4}
        />

        {error !== null && <p className="error">{error}</p>}
        {sent && <p className="saved">Thank you — your feedback is in.</p>}

        <button className="primary" type="submit" disabled={busy || message.trim().length < 3}>
          {busy ? 'Sending…' : 'Send feedback'}
        </button>
      </form>
    </div>
  );
}

type Row = Awaited<ReturnType<typeof listFeedback>>['feedback'][number];

export function RecentFeedback({ token }: { token: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listFeedback(token)
      .then((data) => {
        if (!cancelled) setRows(data.feedback);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="panel">
      <div className="panelhead">
        <div>
          <h3>Recent feedback</h3>
          <p className="sub">From customers, stores and this console</p>
        </div>
      </div>
      {rows === null ? (
        <p className="emptynote">Reading the queue…</p>
      ) : rows.length === 0 ? (
        <p className="emptynote">No feedback yet.</p>
      ) : (
        <div className="grid" style={{ gap: 10 }}>
          {rows.map((row) => (
            <div key={row.id} className="supportcustomer">
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong>{row.category}</strong> · {row.source}
                <span>{row.message}</span>
                <span className="muted">
                  {row.contactEmail ?? 'no email'} · {new Date(row.createdAt).toLocaleString('fi-FI')}
                  {row.page === null ? '' : ` · ${row.page}`}
                </span>
              </div>
              <span className="pill">{row.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

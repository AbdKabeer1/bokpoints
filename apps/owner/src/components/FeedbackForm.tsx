import { useState, type FormEvent } from 'react';
import { ApiError, sendFeedback } from '../api';

/** A short in-app feedback form; the platform admin reads the queue. */
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
      await sendFeedback(token, {
        category,
        message: message.trim(),
        page: 'Support & FAQ',
      });
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
        <label htmlFor="feedback-category">Kind of feedback</label>
        <select
          id="feedback-category"
          value={category}
          onChange={(event) => setCategory(event.target.value as 'bug' | 'idea' | 'other')}
        >
          <option value="bug">Problem</option>
          <option value="idea">Idea</option>
          <option value="other">Other</option>
        </select>

        <label htmlFor="feedback-message">Message</label>
        <textarea
          id="feedback-message"
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

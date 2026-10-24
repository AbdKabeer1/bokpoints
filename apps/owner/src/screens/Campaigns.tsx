import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  getCampaignAudience,
  listCampaigns,
  sendCampaign,
  type Audience,
  type Campaign,
} from '../api';
import { ownerMessage } from '../errors';
import { formatTimestamp } from '../format';

/**
 * In-app campaigns (D-148). One short message, sent inside the customer
 * app to the people who opted in. There is no email or SMS sender yet, so
 * those channels are shown as honestly unavailable, not as dead switches.
 */
export function CampaignsScreen({ token, storeId }: { token: string; storeId: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [audience, setAudience] = useState<Audience | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, reach] = await Promise.all([
        listCampaigns(token, storeId),
        getCampaignAudience(token, storeId),
      ]);
      setCampaigns(list.campaigns);
      setAudience(reach);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'The API is not reachable.');
    }
  }, [token, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canSend =
    title.trim() !== '' && body.trim() !== '' && (audience?.optedIn ?? 0) > 0 && !busy;

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const sent = await sendCampaign(token, storeId, {
        title: title.trim(),
        body: body.trim(),
      });
      setFlash(
        sent.recipients === 0
          ? 'Saved, but it reached no one: no customer has opted in yet.'
          : `Sent to ${sent.recipients} customer${sent.recipients === 1 ? '' : 's'}. It is in their Poket inbox now.`,
      );
      setTitle('');
      setBody('');
      setConfirming(false);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'Could not send it.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Campaigns</h1>
          <p className="sub">One short message to your customers, inside the Poket app</p>
        </div>
      </div>

      {error !== null && <p className="error">{error}</p>}
      {flash !== null && <p className="oknote">{flash}</p>}

      {audience !== null && audience.optedIn === 0 && (
        <div className="callout warn">
          <span className="ico" aria-hidden="true">
            !
          </span>
          <p>
            <strong>
              {audience.linked === 0
                ? 'No customers are linked to this store yet.'
                : 'No customer has opted in to store news yet.'}
            </strong>{' '}
            {audience.linked === 0
              ? 'A customer joins the first time they earn points here.'
              : `${audience.linked} customer${audience.linked === 1 ? ' is' : 's are'} linked. Store news is off by default; each customer turns it on from the store page in their Poket app.`}
          </p>
        </div>
      )}

      <div className="grid two">
        <div className="grid" style={{ gap: 16 }}>
          <form className="panel" onSubmit={(event) => void handleSend(event)}>
            <div className="panelhead">
              <div>
                <h3>Write a message</h3>
                <p className="sub">It appears in the customer’s inbox and as an in-app notice</p>
              </div>
              <span className="pill active">
                <span className="dot" aria-hidden="true" />
                In-app
              </span>
            </div>

            <div className="compose">
              <label htmlFor="campaign-title">Title</label>
              <input
                id="campaign-title"
                value={title}
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Double points this Saturday"
                disabled={busy}
              />
              <p className="charcount">{title.length}/80</p>

              <label htmlFor="campaign-body">Message</label>
              <textarea
                id="campaign-body"
                value={body}
                maxLength={300}
                rows={4}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Come in before 18:00 and earn twice the points on everything."
                disabled={busy}
              />
              <p className="charcount">{body.length}/300</p>
            </div>

            {!confirming ? (
              <button
                className="primary"
                type="submit"
                disabled={!canSend}
                onClick={(event) => {
                  if (!canSend) return;
                  event.preventDefault();
                  setConfirming(true);
                }}
              >
                Review and send
              </button>
            ) : (
              <div className="callout warn" style={{ marginTop: 12 }}>
                <span className="ico" aria-hidden="true">
                  !
                </span>
                <p>
                  Send “{title.trim()}” to {audience?.optedIn ?? 0} customer
                  {(audience?.optedIn ?? 0) === 1 ? '' : 's'} now? A sent campaign cannot be
                  recalled.
                </p>
                <span className="act actions">
                  <button className="ghost small" type="button" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                  <button className="primary small" type="submit" disabled={busy}>
                    {busy ? 'Sending…' : 'Send now'}
                  </button>
                </span>
              </div>
            )}

            <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>
              Email and SMS are not connected yet. Only customers who opted in receive this.
            </p>
          </form>

          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>Sent campaigns</h3>
                <p className="sub">Newest first, with how many opened</p>
              </div>
            </div>

            {campaigns === null ? (
              <p className="muted">Loading…</p>
            ) : campaigns.length === 0 ? (
              <p className="emptynote">
                Nothing sent yet. Your first campaign will appear here with its reach.
              </p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Message</th>
                    <th>Sent</th>
                    <th className="num">Reached</th>
                    <th className="num">Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id}>
                      <td>
                        <strong style={{ fontWeight: 650 }}>{campaign.title}</strong>
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {campaign.body}
                        </div>
                      </td>
                      <td className="mono" title={formatTimestamp(campaign.createdAt)}>
                        {new Date(campaign.createdAt).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </td>
                      <td className="num">{campaign.recipients}</td>
                      <td className="num">
                        {campaign.recipients === 0
                          ? '—'
                          : `${campaign.opened} · ${Math.round(
                              (campaign.opened / campaign.recipients) * 100,
                            )}%`}
                      </td>
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
                <h3>Who will receive it</h3>
                <p className="sub">The audience right now</p>
              </div>
            </div>

            {audience === null ? (
              <p className="muted">Loading…</p>
            ) : (
              <>
                <div className="kv">
                  <div>
                    <dt>Customers linked to this store</dt>
                    <dd>{audience.linked}</dd>
                  </div>
                  <div>
                    <dt>Opted in to store news</dt>
                    <dd>{audience.optedIn}</dd>
                  </div>
                </div>
                <div
                  className="segbar"
                  role="progressbar"
                  aria-label="Customers opted in"
                  aria-valuenow={audience.optedIn}
                  aria-valuemin={0}
                  aria-valuemax={Math.max(1, audience.linked)}
                >
                  {Array.from({ length: 10 }, (_, index) => (
                    <span
                      key={index}
                      className={
                        audience.linked === 0
                          ? ''
                          : index < Math.round((audience.optedIn / audience.linked) * 10)
                            ? 'on'
                            : ''
                      }
                    />
                  ))}
                </div>
                <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                  Consent is per store and off by default (GDPR). Customers switch it on from
                  the store page in their app.
                </p>
              </>
            )}
          </div>

          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>Channels</h3>
                <p className="sub">What this build can send</p>
              </div>
            </div>

            <div className="attention">
              <div className="item">
                <span className="tile good" aria-hidden="true">
                  ✓
                </span>
                <div style={{ flex: 1 }}>
                  <strong>In-app push</strong>
                  <p>Delivered to the Poket inbox, with read counts.</p>
                </div>
              </div>
              <div className="item locked">
                <span className="tile" aria-hidden="true">
                  ✉
                </span>
                <div style={{ flex: 1 }}>
                  <strong>Email · later</strong>
                  <p>Needs a verified sender domain and an email service.</p>
                </div>
              </div>
              <div className="item locked">
                <span className="tile" aria-hidden="true">
                  ✆
                </span>
                <div style={{ flex: 1 }}>
                  <strong>SMS · later</strong>
                  <p>Needs a messaging provider and per-message pricing.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="preview-phone">
            <p className="eyebrow" style={{ marginBottom: 8 }}>
              How it looks in the app
            </p>
            <div className="preview-bubble">
              <div className="from">
                <span className="avatar" style={{ width: 26, height: 26, fontSize: 9 }}>
                  KB
                </span>
                <div>
                  <strong style={{ fontSize: 11 }}>Your store</strong>
                  <span>now</span>
                </div>
              </div>
              <strong>{title.trim() === '' ? 'Your title' : title}</strong>
              <p>{body.trim() === '' ? 'Your message appears here.' : body}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

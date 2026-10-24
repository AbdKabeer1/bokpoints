import type { Tab } from '../Shell';

const FAQ: { q: string; a: string }[] = [
  {
    q: 'A customer says their points are missing. What do I check?',
    a: 'Open Customers and search their name or email. Their detail page shows every award, redemption and expiry with the balance after each one. If a sale was recorded twice, an owner or manager can reverse it from the till within 15 minutes.',
  },
  {
    q: 'Why did a purchase earn nothing?',
    a: 'Three usual reasons: the basket was below the rule’s minimum, no earning rule is active, or the sale hit the store’s per-sale ceiling. Rules shows the active rule; the till shows the reason on the preview before you confirm.',
  },
  {
    q: 'A customer cannot use a reward.',
    a: 'Check three things in this order: the reward is active, they have enough points, and they have not already used it today if it has a daily limit. The till refuses with a plain sentence, and the reason is recorded.',
  },
  {
    q: 'Do campaigns send email or SMS?',
    a: 'No. In this build a campaign is an in-app message in the customer’s Poket inbox. Email needs a verified sender domain; SMS needs a messaging provider. Both are shown as unavailable rather than as switches that do nothing.',
  },
  {
    q: 'Why does a campaign reach fewer people than I expected?',
    a: 'Store news is off by default and each customer turns it on per store. The Campaigns page shows how many customers are linked and how many have opted in. Only the second number receives a message.',
  },
  {
    q: 'How do I add a cashier?',
    a: 'People → Invite. In this build the person is added by the platform admin, because staff invitation emails need the platform’s email sender. Once added, they sign in with a one-time code and their authenticator app.',
  },
  {
    q: 'What is the difference between a reversal and an adjustment?',
    a: 'A reversal undoes a specific sale and its points, and is recorded against that sale. An adjustment is a manual correction with a reason, for things a reversal cannot fix. Both appear in the audit log with who did it and why.',
  },
];

/**
 * Support and the questions a store asks in its first week. The answers
 * describe what this build actually does; where a channel is not connected
 * yet, the page says so instead of offering a button that fails.
 */
export function SupportScreen({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Support &amp; FAQ</h1>
          <p className="sub">Plain answers about points, rewards, campaigns and access</p>
        </div>
      </div>

      <div className="grid two">
        <div className="panel">
          <div className="panelhead">
            <div>
              <h3>Common questions</h3>
              <p className="sub">Tap a question to open it</p>
            </div>
          </div>

          <div className="faq">
            {FAQ.map((entry) => (
              <details key={entry.q}>
                <summary>{entry.q}</summary>
                <p>{entry.a}</p>
              </details>
            ))}
          </div>
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>Talk to us</h3>
                <p className="sub">Pilot support</p>
              </div>
            </div>
            <p style={{ fontSize: 13 }}>
              During the pilot, your Poket contact answers directly. Support email and in-app
              chat are not connected in this build, and no button here pretends otherwise.
            </p>
            <div className="placeholdercard" style={{ marginTop: 10, marginBottom: 0 }}>
              <strong>Support email · later</strong>
              <p>Arrives with the verified sender domain.</p>
            </div>
          </div>

          <div className="panel tint">
            <div className="panelhead">
              <div>
                <h3>Fix something now</h3>
                <p className="sub">The pages that answer most questions</p>
              </div>
            </div>
            <div className="grid" style={{ gap: 6 }}>
              <button className="ghost" type="button" onClick={() => onNavigate('rules')}>
                Earning rules
              </button>
              <button className="ghost" type="button" onClick={() => onNavigate('rewards')}>
                Rewards
              </button>
              <button className="ghost" type="button" onClick={() => onNavigate('customers')}>
                Customers
              </button>
              <button className="ghost" type="button" onClick={() => onNavigate('audit')}>
                Audit log
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

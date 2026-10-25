import type { Tab } from '../Shell';

/**
 * Plan and billing, shown honestly: the pilot runs on a direct arrangement,
 * and the panels that need a payment provider are described, not faked.
 */
export function BillingScreen({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Plan and billing</h1>
          <p className="sub">What you are on, and what arrives with the platform</p>
        </div>
      </div>

      <div className="grid two">
        <div className="grid" style={{ gap: 16 }}>
          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>Current plan</h3>
                <p className="sub">Set up directly with OmaPointii</p>
              </div>
              <span className="pill active">
                <span className="dot" aria-hidden="true" />
                Pilot
              </span>
            </div>

            <div className="kv">
              <div>
                <dt>Plan</dt>
                <dd>Pilot</dd>
              </div>
              <div>
                <dt>Renewal</dt>
                <dd>Agreed with your OmaPointii contact</dd>
              </div>
              <div>
                <dt>Payment method</dt>
                <dd>Not connected</dd>
              </div>
              <div>
                <dt>Invoices</dt>
                <dd>Not issued in this build</dd>
              </div>
            </div>

            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              When billing switches on, this page will show your plan, the customer limit, the
              renewal date and every invoice. Nothing here will be backdated.
            </p>
          </div>

          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>What will appear here</h3>
                <p className="sub">Not live yet</p>
              </div>
            </div>

            <ul className="checklist">
              <li>
                <span className="state" aria-hidden="true" />
                <span className="txt">
                  <strong>Your plan and customer limit</strong>
                  <span>Active customers against the tier’s ceiling, as a segmented bar.</span>
                </span>
              </li>
              <li>
                <span className="state" aria-hidden="true" />
                <span className="txt">
                  <strong>Card and payment method</strong>
                  <span>Handled by the payment provider; OmaPointii never stores card details.</span>
                </span>
              </li>
              <li>
                <span className="state" aria-hidden="true" />
                <span className="txt">
                  <strong>Invoices and receipts</strong>
                  <span>Downloadable, with the Finnish VAT breakdown.</span>
                </span>
              </li>
              <li>
                <span className="state" aria-hidden="true" />
                <span className="txt">
                  <strong>Failed-payment notices</strong>
                  <span>The reminder, paused and suspended stages, with a clear next step.</span>
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <div className="panel tint">
            <div className="panelhead">
              <div>
                <h3>Questions about the pilot</h3>
                <p className="sub">Your contact answers directly</p>
              </div>
            </div>
            <p style={{ fontSize: 13 }}>
              Plan changes, extra stores and invoicing are arranged with your OmaPointii contact while
              the pilot runs. There is no self-service payment in this build.
            </p>
            <button
              className="ghost small"
              type="button"
              style={{ marginTop: 8 }}
              onClick={() => onNavigate('support')}
            >
              Support &amp; FAQ
            </button>
          </div>

          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>Why no billing yet</h3>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12.5 }}>
              Billing needs a payment provider, a verified business identity and a live domain.
              Until those exist, a “Manage payment” button would fail, so it is not shown.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

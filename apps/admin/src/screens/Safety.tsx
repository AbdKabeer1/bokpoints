/**
 * The safety surface. The product defines the actions; the data they act on
 * — abuse flags and campaign reports — has no source yet, so the page says
 * what will appear instead of inventing cases.
 */
export function SafetyScreen() {
  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Safety</h1>
          <p className="sub">Abuse, anonymisation and campaign takedowns</p>
        </div>
      </div>

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

        <div className="grid" style={{ gap: 16 }}>
          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>What this page will do</h3>
                <p className="sub">Typed confirmation, reason, audit</p>
              </div>
            </div>
            <div className="placeholdercard">
              <strong>Anonymise a customer</strong>
              <p>
                Keeps the ledger totals, removes the identity, needs a reason and cannot be undone.
              </p>
            </div>
            <div className="placeholdercard">
              <strong>Disable a campaign</strong>
              <p>Stops further delivery; the sent copies stay readable in the inbox.</p>
            </div>
            <div className="placeholdercard" style={{ marginBottom: 0 }}>
              <strong>Suspend a store</strong>
              <p>Already live on each store’s detail page under Stores.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { ApiError, getReports, type Reports as ReportsData } from '../api';
import { ownerMessage } from '../errors';
import { ActivityChart } from '../components/ActivityChart';

const points = (value: number): string => value.toLocaleString('fi-FI');

/** Reports reads one honest window: the last thirty days, plus the total. */
export function ReportsScreen({ token, storeId }: { token: string; storeId: string }) {
  const [reports, setReports] = useState<ReportsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReports(await getReports(token, storeId));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'The API is not reachable.');
    }
  }, [token, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Reports</h1>
          <p className="sub">The last thirty days, and every customer so far</p>
        </div>
      </div>

      {error !== null && <p className="error">{error}</p>}

      {reports === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="statstrip">
            <div className="stat">
              <p className="statlabel">Customers so far</p>
              <p className="statvalue">{points(reports.customers)}</p>
              <p className="statfoot">{points(reports.newCustomers30d)} joined in 30 days</p>
            </div>
            <div className="stat">
              <p className="statlabel">Visits · 30 days</p>
              <p className="statvalue">{points(reports.visits30d)}</p>
              <p className="statfoot">Sales recorded at the till</p>
            </div>
            <div className="stat">
              <p className="statlabel">Points issued</p>
              <p className="statvalue">{points(reports.pointsIssued30d)}</p>
              <p className="statfoot">{points(reports.pointsRedeemed30d)} redeemed</p>
            </div>
            <div className="stat">
              <p className="statlabel">Points expired</p>
              <p className="statvalue">{points(reports.pointsExpired30d)}</p>
              <p className="statfoot">Left balances in 30 days</p>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <ActivityChart reports={reports} />
          </div>

          <p className="muted" style={{ fontSize: 12 }}>
            Redeemed and expired points are what left customers’ balances in the last thirty
            days. The fuller reports — per-store comparisons, campaign measures — arrive with the
            pilot’s data.
          </p>
        </>
      )}
    </section>
  );
}

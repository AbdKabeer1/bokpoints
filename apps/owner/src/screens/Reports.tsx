import { useCallback, useEffect, useState } from 'react';
import { ApiError, getReports, type Reports as ReportsData } from '../api';
import { ownerMessage } from '../errors';

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="statcard">
      <p className="statvalue">{value.toLocaleString('en-FI')}</p>
      <p className="statlabel">{label}</p>
    </div>
  );
}

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
      <div className="sectionhead">
        <h2>Reports</h2>
      </div>

      <p className="muted">The last thirty days at this store, and every customer so far.</p>

      {error !== null && <p className="error">{error}</p>}

      {reports !== null && (
        <>
          <div className="statgrid">
            <StatCard label="Customers so far" value={reports.customers} />
            <StatCard label="New in 30 days" value={reports.newCustomers30d} />
            <StatCard label="Visits in 30 days" value={reports.visits30d} />
          </div>
          <div className="statgrid">
            <StatCard label="Points issued" value={reports.pointsIssued30d} />
            <StatCard label="Points redeemed" value={reports.pointsRedeemed30d} />
            <StatCard label="Points expired" value={reports.pointsExpired30d} />
          </div>
          <p className="muted small">
            Redeemed and expired points are what left customers' balances in the last thirty
            days. The fuller reports — per-store comparisons, campaign measures — arrive with
            the pilot's data.
          </p>
        </>
      )}
    </section>
  );
}

import type { Reports } from '../api';

const shortDate = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * The store's last thirty days: points issued and redeemed as bars, visits as
 * a line. One honest chart from real data — no forecast, no invented insight.
 */
export function ActivityChart({ reports }: { reports: Reports }) {
  const series = reports.series;
  const maxPoints = Math.max(1, ...series.map((point) => Math.max(point.issued, point.redeemed)));
  const maxVisits = Math.max(1, ...series.map((point) => point.visits));
  const width = 600;
  const height = 130;
  const step = series.length > 1 ? width / (series.length - 1) : width;
  const line = series
    .map((point, index) => `${index * step},${height - (point.visits / maxVisits) * height}`)
    .join(' ');

  return (
    <div className="panel">
      <div className="panelhead">
        <div>
          <h3>Loyalty activity</h3>
          <p className="sub">Last 30 days · points and visits</p>
        </div>
        <div className="legend">
          <span>
            <i className="swatch green" aria-hidden="true" /> Issued
          </span>
          <span>
            <i className="swatch amber" aria-hidden="true" /> Redeemed
          </span>
          <span>
            <i className="swatch blue" aria-hidden="true" /> Visits
          </span>
        </div>
      </div>

      {series.length === 0 ? (
        <p className="emptynote">No activity recorded yet.</p>
      ) : (
        <>
          <div
            className="chart"
            role="img"
            aria-label="Points issued, redeemed and visits over the last thirty days"
          >
            <div className="chartbars">
              {series.map((point) => (
                <div
                  className="chartday"
                  key={point.date}
                  title={`${shortDate(point.date)}: ${point.issued} issued, ${point.redeemed} redeemed, ${point.visits} visits`}
                >
                  <i
                    className="bar green"
                    style={{ height: `${Math.max(2, (point.issued / maxPoints) * 100)}%` }}
                  />
                  <i
                    className="bar amber"
                    style={{ height: `${Math.max(2, (point.redeemed / maxPoints) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
            <svg
              className="chartline"
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polyline points={line} fill="none" stroke="var(--info)" strokeWidth="2.5" />
            </svg>
          </div>

          <div className="chartlabels">
            <span>{shortDate(series[0]?.date ?? '')}</span>
            <span>{shortDate(series[Math.floor(series.length / 2)]?.date ?? '')}</span>
            <span>Today</span>
          </div>
        </>
      )}
    </div>
  );
}

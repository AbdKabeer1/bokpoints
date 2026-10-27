import { useEffect, useState } from 'react';
import { Filter, Loader2, Search, X } from 'lucide-react';
import { listLeads, type BusinessLead } from '../api';
import { formatDate } from '../format';

const STATUSES = ['invited', 'contacted', 'joined', 'declined'] as const;

type Status = (typeof STATUSES)[number];

export function LeadsScreen({ token }: { token: string }) {
  const [leads, setLeads] = useState<BusinessLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listLeads(token, query)
      .then((data) => {
        if (!cancelled) {
          setLeads(data.leads);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, query]);

  const filtered = leads.filter((lead) => {
    if (statusFilter !== 'all' && lead.status !== statusFilter) return false;
    return true;
  });

  const statusBadge = (status: string) => {
    const palette: Record<string, { bg: string; fg: string }> = {
      invited: { bg: 'var(--info-soft)', fg: 'var(--info)' },
      contacted: { bg: 'var(--warn-soft)', fg: 'var(--gold)' },
      joined: { bg: 'var(--green-soft)', fg: 'var(--green-deep)' },
      declined: { bg: 'var(--danger-soft)', fg: 'var(--danger)' },
    };
    const { bg, fg } = palette[status] ?? { bg: 'var(--soft)', fg: 'var(--muted)' };
    return (
      <span className="badge" style={{ backgroundColor: bg, color: fg }}>
        {status}
      </span>
    );
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Business leads</h1>
        <p className="muted">
          Every invite an owner has sent from the Nearby businesses screen. Filter
          by status or search by name, category or store.
        </p>
      </header>

      <div className="toolbar">
        <div className="toolbar-left">
          <label className="search-wrap">
            <Search size={16} strokeWidth={2} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search leads…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                className="clear"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <X size={14} strokeWidth={2} />
              </button>
            )}
          </label>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as Status | 'all')}
            className="filter-select"
          >
            <option value="all">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-right">
          <span className="count">{filtered.length} lead{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {loading ? (
        <div className="loading">
          <Loader2 size={24} strokeWidth={2} className="spin" aria-hidden="true" />
          <span>Loading leads…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <Filter size={48} strokeWidth={1.5} aria-hidden="true" />
          <p>No leads match your filters.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="leads-table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Category</th>
                <th>Invited by</th>
                <th>Status</th>
                <th>Invited</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr key={lead.leadId}>
                  <td>
                    <div className="lead-cell">
                      <div className="lead-name">{lead.name}</div>
                      <div className="lead-meta">
                        {lead.address && (
                          <>
                            <span className="dot" aria-hidden="true" />
                            {lead.address}
                          </>
                        )}
                        {lead.website && (
                          <>
                            <span className="dot" aria-hidden="true" />
                            <a href={lead.website} target="_blank" rel="noreferrer">
                              Website
                            </a>
                          </>
                        )}
                        {lead.openingHours && (
                          <>
                            <span className="dot" aria-hidden="true" />
                            <span>{lead.openingHours}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>{lead.category ?? '—'}</td>
                  <td>
                    <div className="store-link">
                      <span className="store-dot" style={{ backgroundColor: lead.storeBrandColor ?? 'var(--green)' }} />
                      {lead.storeName}
                    </div>
                  </td>
                  <td>{statusBadge(lead.status)}</td>
                  <td className="date-cell">{formatDate(lead.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
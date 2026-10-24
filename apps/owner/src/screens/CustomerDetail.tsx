import { useCallback, useEffect, useState } from 'react';
import { ApiError, getCustomerHistory, type CustomerHistory } from '../api';
import { ownerMessage } from '../errors';
import { formatDateTime } from '../format';
import { euroText } from '../format';

const TYPE_LABELS: Record<string, string> = {
  earn: 'Purchase',
  redeem: 'Reward taken',
  adjust: 'Adjustment',
  expire: 'Expired',
  reversal: 'Reversed sale',
  fraud_clawback: 'Fraud clawback',
};

const ACTIVITY_LABELS: Record<string, string> = {
  earn: 'earned',
  redeem: 'redeemed',
  adjust: 'adjusted',
  expire: 'expired',
  reversal: 'reversed',
  fraud_clawback: 'clawed back',
};

interface CustomerDetailProps {
  name: string;
  customerId: string;
  token: string;
  storeId: string;
  onClose: () => void;
}

/** One customer's story at this store: balance, then the last hundred entries. */
export function CustomerDetail({ name, customerId, token, storeId, onClose }: CustomerDetailProps) {
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setHistory(await getCustomerHistory(token, storeId, customerId));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'The API is not reachable.');
    }
  }, [token, storeId, customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="detail">
      <div className="detailhead">
        <p className="big">{name}</p>
        <p className="muted">
          {history === null ? '…' : `${history.balance} points at this store`}
        </p>
        <button className="ghost small" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      {error !== null && <p className="error">{error}</p>}

      {history !== null && history.entries.length === 0 && (
        <p className="emptynote">Nothing yet — no visits recorded.</p>
      )}

      {history !== null && history.entries.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>What</th>
              <th>Points</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {history.entries.map((entry) => (
              <tr key={entry.id}>
                <td className="muted">{formatDateTime(entry.createdAt)}</td>
                <td>{TYPE_LABELS[entry.type] ?? entry.type}</td>
                <td className={entry.points < 0 ? 'negative' : 'positive'}>
                  {entry.points > 0 ? `+${entry.points}` : entry.points}
                </td>
                <td className="muted">
                  {entry.reason ??
                    (entry.type === 'earn' && entry.amountCents !== null
                      ? `on ${euroText(entry.amountCents)}`
                      : entry.amountCents !== null
                        ? `on ${euroText(entry.amountCents)} ${ACTIVITY_LABELS[entry.type] ?? ''}`
                        : '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

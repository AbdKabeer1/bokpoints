import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, createReward, editReward, listRewards, type Reward } from '../api';
import { ownerMessage } from '../errors';

/** Empty = no per-customer daily limit. The ledger counts takes per day. */
const UNLIMITED = '';

export function RewardsScreen({ token, storeId }: { token: string; storeId: string }) {
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [limit, setLimit] = useState(UNLIMITED);

  const load = useCallback(async () => {
    try {
      setRewards((await listRewards(token, storeId)).rewards);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'The API is not reachable.');
    }
  }, [token, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const parsePoints = (value: string): number | null => {
    const points = Number.parseInt(value.replace(',', '.').trim(), 10);
    return Number.isInteger(points) && points > 0 ? points : null;
  };

  /** null means "no limit"; undefined means the box held something that is not a number. */
  const parseLimit = (value: string): number | null | undefined => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const pointsCost = parsePoints(cost);
    if (pointsCost === null) {
      setError('The points cost has to be a whole number above zero.');
      return;
    }
    const perCustomerPerDayLimit = parseLimit(limit);
    if (perCustomerPerDayLimit === undefined) {
      setError('The daily limit has to be a whole number above zero, or empty for none.');
      return;
    }

    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await createReward(token, storeId, {
        name: name.trim(),
        pointsCost,
        perCustomerPerDayLimit,
      });
      setName('');
      setCost('');
      setLimit(UNLIMITED);
      setFlash('Reward added.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'Could not save the reward.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (reward: Reward) => {
    setBusy(true);
    setError(null);
    try {
      await editReward(token, storeId, reward.rewardId, { active: !reward.active });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'Could not update it.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Rewards</h1>
          <p className="sub">
            What a customer spends points on. The till offers what they can afford and takes the
            points when the reward is handed over.
          </p>
        </div>
      </div>

      {error !== null && <p className="error">{error}</p>}
      {flash !== null && <p className="flash">{flash}</p>}

      <form className="panel" onSubmit={(event) => void handleCreate(event)}>
        <div className="panelhead">
          <div>
            <h3>Add a reward</h3>
            <p className="sub">A short name the cashier and the customer both understand</p>
          </div>
        </div>
        <div className="composer-row">
          <div>
            <label htmlFor="reward-name">Name</label>
            <input
              id="reward-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Free coffee"
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor="reward-cost">Points</label>
            <input
              id="reward-cost"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              placeholder="100"
              inputMode="numeric"
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor="reward-limit">Daily limit</label>
            <input
              id="reward-limit"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              placeholder="Optional"
              inputMode="numeric"
              disabled={busy}
            />
          </div>
          <button className="primary" type="submit" disabled={busy || name.trim() === ''}>
            {busy ? 'Saving…' : 'Add reward'}
          </button>
        </div>
      </form>

      {rewards !== null && rewards.length === 0 && (
        <p className="emptynote">No rewards yet. Add the first one above.</p>
      )}

      {rewards !== null && rewards.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">Points</th>
              <th className="num">Daily limit</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rewards.map((reward) => (
              <tr key={reward.rewardId}>
                <td>{reward.name}</td>
                <td className="num">{reward.pointsCost.toLocaleString('fi-FI')}</td>
                <td className="num muted">{reward.perCustomerPerDayLimit ?? 'No limit'}</td>
                <td>
                  <span className={reward.active ? 'chip active' : 'chip pending'}>
                    {reward.active ? 'Active' : 'Paused'}
                  </span>
                </td>
                <td>
                  <button
                    className="ghost small"
                    type="button"
                    onClick={() => void toggleActive(reward)}
                    disabled={busy}
                  >
                    {reward.active ? 'Pause' : 'Resume'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted small">
        Pausing a reward stops it appearing at the till; points already spent on it stay spent.
        A reward's name and cost only speak for takes from now on.
      </p>
    </section>
  );
}

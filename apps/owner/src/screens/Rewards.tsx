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
        <h1>Rewards</h1>
      </div>

      <p className="muted">
        What a customer spends their points on. The till shows the ones a customer can afford and
        takes the points when the reward is given.
      </p>

      {error !== null && <p className="error">{error}</p>}
      {flash !== null && <p className="flash">{flash}</p>}

      <form className="form" onSubmit={(event) => void handleCreate(event)}>
        <h3>Add a reward</h3>
        <label htmlFor="reward-name">Name</label>
        <input
          id="reward-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Free coffee"
          disabled={busy}
        />

        <label htmlFor="reward-cost">Points it costs</label>
        <input
          id="reward-cost"
          value={cost}
          onChange={(event) => setCost(event.target.value)}
          placeholder="100"
          inputMode="numeric"
          disabled={busy}
        />

        <label htmlFor="reward-limit">Per-customer daily limit (optional)</label>
        <input
          id="reward-limit"
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
          placeholder="No limit"
          inputMode="numeric"
          disabled={busy}
        />

        <button className="primary" type="submit" disabled={busy || name.trim() === ''}>
          {busy ? 'Saving…' : 'Add reward'}
        </button>
      </form>

      {rewards !== null && rewards.length === 0 && (
        <p className="emptynote">No rewards yet. Add the first one above.</p>
      )}

      {rewards !== null && rewards.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Points</th>
              <th>Daily limit</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rewards.map((reward) => (
              <tr key={reward.rewardId}>
                <td>{reward.name}</td>
                <td>{reward.pointsCost}</td>
                <td className="muted">{reward.perCustomerPerDayLimit ?? 'No limit'}</td>
                <td>
                  <span className={reward.active ? 'chip active' : 'chip pending'}>
                    {reward.active ? 'Offered' : 'Paused'}
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

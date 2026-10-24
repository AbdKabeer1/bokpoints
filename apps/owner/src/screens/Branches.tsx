import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, createBranch, getBranches, type Branch } from '../api';
import { ownerMessage } from '../errors';

export function BranchesScreen({ token, storeId }: { token: string; storeId: string }) {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBranches((await getBranches(token, storeId)).branches);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'The API is not reachable.');
    }
  }, [token, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      setBranches((await createBranch(token, storeId, name.trim())).branches);
      setName('');
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'Could not add it.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="pagehead">
        <h1>Branches</h1>
      </div>

      <p className="muted">
        The counters of one store. The till asks which branch a sale belongs to when there is
        more than one; a staff member can be limited to a single branch.
      </p>

      {error !== null && <p className="error">{error}</p>}

      <form className="form" onSubmit={(event) => void handleAdd(event)}>
        <label htmlFor="branch-name">Add a branch</label>
        <div className="inlineform">
          <input
            id="branch-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Kamppi"
            disabled={busy}
          />
          <button className="primary" type="submit" disabled={busy || name.trim() === ''}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>

      {branches !== null && branches.length === 0 && (
        <p className="emptynote">No branches — the whole store is one counter.</p>
      )}

      {branches !== null && branches.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((branch) => (
              <tr key={branch.branchId}>
                <td>{branch.name}</td>
                <td>
                  <span className={branch.status === 'active' ? 'chip active' : 'chip pending'}>
                    {branch.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

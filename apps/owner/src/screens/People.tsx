import { useCallback, useEffect, useState } from 'react';
import { ApiError, listStaff, type StaffMember } from '../api';
import { ownerMessage } from '../errors';

export function PeopleScreen({ token, storeId }: { token: string; storeId: string }) {
  const [members, setMembers] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMembers((await listStaff(token, storeId)).members);
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
        <h1>People</h1>
      </div>

      {error !== null && <p className="error">{error}</p>}

      {members !== null && members.length === 0 && (
        <p className="emptynote">Nobody is connected to this store yet.</p>
      )}

      {members !== null && members.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Branch</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.memberId}>
                <td>{member.name}</td>
                <td className="muted">{member.email}</td>
                <td>{member.role}</td>
                <td className="muted">{member.locationName ?? 'Every branch'}</td>
                <td>
                  <span className={member.status === 'active' ? 'chip active' : 'chip pending'}>
                    {member.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted small">
        Inviting new staff by email arrives with the sign-up side of the platform, once the
        invite-email provider is settled — the list above is live, the invitations are not
        wired into the portal yet.
      </p>
    </section>
  );
}

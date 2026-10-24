import { useCallback, useEffect, useState } from 'react';
import { ApiError, listStaff, type StaffMember } from '../api';
import { ownerMessage } from '../errors';

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

const roleLabel = (role: string): string =>
  role === 'owner' ? 'Owner' : role === 'manager' ? 'Manager' : role === 'cashier' ? 'Cashier' : role;

const statusLabel = (status: string): string =>
  status === 'active' ? 'Active' : status === 'invited' ? 'Invited' : status;

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
        <div>
          <h1>People</h1>
          <p className="sub">
            {members === null
              ? 'Loading…'
              : `${members.length} ${members.length === 1 ? 'person' : 'people'} with access`}
          </p>
        </div>
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
                <td>
                  <span className="person">
                    <span className="avatar" aria-hidden="true">
                      {initials(member.name === '' ? member.email : member.name)}
                    </span>
                    {member.name === '' ? member.email : member.name}
                  </span>
                </td>
                <td className="muted">{member.email}</td>
                <td>{roleLabel(member.role)}</td>
                <td className="muted">{member.locationName ?? 'Every branch'}</td>
                <td>
                  <span className={member.status === 'active' ? 'pill active' : 'pill warn'}>
                    <span className="dot" aria-hidden="true" />
                    {statusLabel(member.status)}
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

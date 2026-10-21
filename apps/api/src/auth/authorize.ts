import { and, eq } from 'drizzle-orm';
import { can, type Capability, type Role } from '@bokpoints/shared';
import type { Database } from '../db/client.js';
import { staffUsers, storeMembers } from '../db/schema.js';
import type { SessionResolver } from './session.js';

export type AuthErrorCode =
  | 'MISSING_TOKEN'
  | 'INVALID_TOKEN'
  | 'STORE_MISMATCH'
  | 'NOT_A_MEMBER'
  | 'FORBIDDEN';

export type AuthResult =
  | { ok: true; staffUserId: string; role: Role }
  | { ok: false; status: 401 | 403; error: { code: AuthErrorCode; message: string } };

export interface AuthorizeOptions {
  token: string | undefined;
  storeId: string;
  /** The capability that grants access. Any one of them is enough. */
  anyOf: Capability[];
}

const failure = (
  status: 401 | 403,
  code: AuthErrorCode,
  message: string,
): AuthResult => ({ ok: false, status, error: { code, message } });

/**
 * Turns the role stored on a store membership into the role used by the
 * permissions matrix (FRD section 2).
 */
function toRole(memberRole: string): Role | null {
  if (memberRole === 'owner') return 'store_owner';
  if (memberRole === 'manager') return 'store_manager';
  if (memberRole === 'cashier') return 'cashier';
  return null;
}

/**
 * Authenticates the caller and checks that they may act in this store.
 *
 * FR-API-2: every API call is authenticated, scoped to one store, and
 * permission-checked. The order matters. The role comes from the database,
 * never from the token, and a caller who is not a member of the store in the
 * URL is refused before any capability is considered.
 */
export async function authorizeStoreRequest(
  db: Database,
  resolver: SessionResolver | undefined,
  options: AuthorizeOptions,
): Promise<AuthResult> {
  if (!options.token) {
    return failure(401, 'MISSING_TOKEN', 'This request needs an access token');
  }

  if (!resolver) {
    return failure(401, 'INVALID_TOKEN', 'This request needs an access token');
  }

  const principal = await resolver.resolve(options.token);
  if (!principal) {
    return failure(401, 'INVALID_TOKEN', 'That access token is not valid');
  }

  const staff = await db
    .select({ isAdmin: staffUsers.isAdmin })
    .from(staffUsers)
    .where(eq(staffUsers.id, principal.staffUserId))
    .limit(1);

  const isAdmin = staff[0]?.isAdmin ?? false;

  let role: Role | null;

  if (isAdmin) {
    // Admins are not members of a store. Their access is checked against the
    // capability matrix like anyone else, and an admin who may not award
    // points is refused (FRD section 2).
    role = 'admin';
  } else {
    const membership = await db
      .select({ role: storeMembers.role, status: storeMembers.status })
      .from(storeMembers)
      .where(and(eq(storeMembers.storeId, options.storeId), eq(storeMembers.userId, principal.staffUserId)))
      .limit(1);

    const member = membership[0];
    if (!member) {
      // Store isolation: a member of another store cannot use this store's
      // URL (FR-PRV-4).
      return failure(403, 'STORE_MISMATCH', 'You are not a member of this store');
    }
    if (member.status !== 'active') {
      return failure(403, 'NOT_A_MEMBER', 'Your access to this store has been deactivated');
    }
    const memberRole = toRole(member.role);
    if (!memberRole) {
      return failure(403, 'NOT_A_MEMBER', 'Your access to this store has been deactivated');
    }
    role = memberRole;
  }

  const permitted = options.anyOf.some((capability) => can(role, capability).allowed);
  if (!permitted) {
    return failure(403, 'FORBIDDEN', 'Your role does not allow this action');
  }

  return { ok: true, staffUserId: principal.staffUserId, role };
}

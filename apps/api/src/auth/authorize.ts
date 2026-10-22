import { and, eq } from 'drizzle-orm';
import { can, type Capability, type Role } from '@bokpoints/shared';
import type { Database } from '../db/client.js';
import { staffUsers, storeMembers } from '../db/schema.js';
import { MfaRequiredError, type SessionResolver } from './session.js';

export type AuthErrorCode =
  | 'MISSING_TOKEN'
  | 'INVALID_TOKEN'
  | 'STORE_MISMATCH'
  | 'NOT_A_MEMBER'
  | 'ACCOUNT_DEACTIVATED'
  | 'MFA_REQUIRED'
  | 'FORBIDDEN';

export type AuthResult =
  | {
      ok: true;
      staffUserId: string;
      role: Role;
      /** The one branch this member is limited to, or null for every branch (D-103). */
      locationId: string | null;
    }
  | { ok: false; status: 401 | 403; error: { code: AuthErrorCode; message: string } };

/**
 * Authenticates the caller and checks a platform-wide capability.
 *
 * The admin's store-independent operations (creating a store, and later the
 * audit view) live here. Exactly the same rules as the store-scoped variant:
 * the token is verified, the role is read from the database, and a caller
 * who is not an admin is refused before any capability is considered.
 */
export type AdminAuthResult =
  | { ok: true; staffUserId: string; role: Role }
  | { ok: false; status: 401 | 403; error: { code: AuthErrorCode; message: string } };

export interface AuthorizeAdminOptions {
  token: string | undefined;
  /** The capability that grants access. Any one of them is enough. */
  anyOf: Capability[];
}

export async function authorizeAdminRequest(
  db: Database,
  resolver: SessionResolver | undefined,
  options: AuthorizeAdminOptions,
): Promise<AdminAuthResult> {
  if (!options.token) {
    return failure(401, 'MISSING_TOKEN', 'This request needs an access token');
  }

  if (!resolver) {
    return failure(401, 'INVALID_TOKEN', 'This request needs an access token');
  }

  let principal;
  try {
    principal = await resolver.resolve(options.token);
  } catch (error) {
    if (error instanceof MfaRequiredError) {
      return failure(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
    }
    throw error;
  }
  if (!principal) {
    return failure(401, 'INVALID_TOKEN', 'That access token is not valid');
  }

  const admin = await db
    .select({ isAdmin: staffUsers.isAdmin, status: staffUsers.status })
    .from(staffUsers)
    .where(eq(staffUsers.id, principal.staffUserId))
    .limit(1);

  const account = admin[0];
  if (!account) {
    return failure(401, 'INVALID_TOKEN', 'That access token is not valid');
  }

  if (account.status !== 'active') {
    return failure(403, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated');
  }

  // FRD section 2: admin accounts are separate. Platform operations on a
  // store-scoped token role would be a privilege escalation, so only a
  // genuine admin row gets past this point.
  if (!account.isAdmin) {
    return failure(403, 'FORBIDDEN', 'This is an admin operation');
  }

  const role: Role = 'admin';
  const permitted = options.anyOf.some((capability) => can(role, capability).allowed);
  if (!permitted) {
    return failure(403, 'FORBIDDEN', 'Your role does not allow this action');
  }

  return { ok: true, staffUserId: principal.staffUserId, role };
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

  let principal;
  try {
    principal = await resolver.resolve(options.token);
  } catch (error) {
    // FR-AUTH-2: a valid token without a second factor is not an invalid
    // token. The app needs to tell the two apart.
    if (error instanceof MfaRequiredError) {
      return failure(403, 'MFA_REQUIRED', 'Multi-factor authentication is required');
    }
    throw error;
  }
  if (!principal) {
    return failure(401, 'INVALID_TOKEN', 'That access token is not valid');
  }

  const staff = await db
    .select({ isAdmin: staffUsers.isAdmin, status: staffUsers.status })
    .from(staffUsers)
    .where(eq(staffUsers.id, principal.staffUserId))
    .limit(1);

  const account = staff[0];
  if (!account) {
    return failure(401, 'INVALID_TOKEN', 'That access token is not valid');
  }

  // A deactivated staff account does not get in, even with a valid token.
  if (account.status !== 'active') {
    return failure(403, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated');
  }

  const isAdmin = account.isAdmin;

  let role: Role | null;
  let locationId: string | null = null;

  if (isAdmin) {
    // Admins are not members of a store. Their access is checked against the
    // capability matrix like anyone else, and an admin who may not award
    // points is refused (FRD section 2).
    role = 'admin';
  } else {
    const membership = await db
      .select({
        role: storeMembers.role,
        status: storeMembers.status,
        locationId: storeMembers.locationId,
      })
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
    locationId = member.locationId;
  }

  const permitted = options.anyOf.some((capability) => can(role, capability).allowed);
  if (!permitted) {
    return failure(403, 'FORBIDDEN', 'Your role does not allow this action');
  }

  return { ok: true, staffUserId: principal.staffUserId, role, locationId };
}

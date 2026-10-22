import { eq } from 'drizzle-orm';
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { Database } from '../db/client.js';
import { staffUsers } from '../db/schema.js';
import {
  MfaRequiredError,
  type AuthenticatedPrincipal,
  type CustomerPrincipal,
  type CustomerSessionResolver,
  type SessionResolver,
} from './session.js';

export interface SupabaseResolverOptions {
  db: Database;
  /** The project URL, for example https://abcdefgh.supabase.co */
  supabaseUrl: string;
  /**
   * Where the public signing keys come from. Defaults to the project's
   * published key set. Tests supply a local one, so they never need a network.
   */
  keys?: JWTVerifyGetKey;
}

/**
 * Only asymmetric algorithms are accepted (D-100). A shared-secret token
 * (HS256) is refused outright, which closes the classic attack of signing a
 * forged token with the public key as if it were a secret.
 */
const ALGORITHMS = ['ES256', 'RS256'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type VerifyToken = (token: string) => Promise<JWTPayload | null>;

/**
 * Verifies a Supabase access token locally against the project's public keys
 * (D-100): no call to Supabase per request, and the key set is cached and
 * refreshed when a key rotates. Returns null for a bad, expired or forged
 * token; a failure to reach the key set is our problem, so it is thrown and
 * surfaces as a server error rather than as a signed-out caller.
 */
function createVerifier(options: SupabaseResolverOptions): VerifyToken {
  const issuer = `${options.supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  const keys = options.keys ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return async (token: string): Promise<JWTPayload | null> => {
    try {
      const verified = await jwtVerify(token, keys, {
        issuer,
        audience: 'authenticated',
        algorithms: ALGORITHMS,
      });
      return verified.payload;
    } catch (error) {
      if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) {
        return null;
      }
      throw error;
    }
  };
}

/**
 * Turns a Supabase access token into a staff principal.
 *
 * The token proves who someone is. It never says what they may do: roles
 * and store access are read from our own tables afterwards (D-098). So a
 * customer, who also has a valid Supabase token, gets nothing here, because
 * no staff account is linked to them.
 */
export function createSupabaseSessionResolver(options: SupabaseResolverOptions): SessionResolver {
  const { db } = options;
  const verify = createVerifier(options);

  return {
    async resolve(token: string): Promise<AuthenticatedPrincipal | null> {
      const payload = await verify(token);
      if (!payload) return null;

      const authUserId = payload.sub;
      if (typeof authUserId !== 'string' || !UUID.test(authUserId)) return null;

      const rows = await db
        .select({ id: staffUsers.id, email: staffUsers.email })
        .from(staffUsers)
        .where(eq(staffUsers.authUserId, authUserId))
        .limit(1);

      const staff = rows[0];
      if (!staff) return null;

      // FR-AUTH-2, D-101: staff and admins must have passed a second factor.
      // `aal2` is Supabase's claim for exactly that. Checked after the staff
      // lookup, so a customer with an ordinary sign-in is just "not valid",
      // while a staff member who skipped MFA is told to complete it.
      if (payload['aal'] !== 'aal2') throw new MfaRequiredError();

      // The email comes from our own record, not from the token.
      return { staffUserId: staff.id, email: staff.email };
    },
  };
}

/**
 * Turns a Supabase access token into a customer principal (D-111).
 *
 * Customers sign in with an email one-time code (FR-AUTH-1), which proves the
 * address; their token is `aal1` and there is no second factor to demand. The
 * token is the only identity this resolver trusts: the customer row is found
 * later by `auth_user_id`, never by anything the caller sends.
 */
export function createSupabaseCustomerResolver(
  options: SupabaseResolverOptions,
): CustomerSessionResolver {
  const verify = createVerifier(options);

  return {
    async resolve(token: string): Promise<CustomerPrincipal | null> {
      const payload = await verify(token);
      if (!payload) return null;

      const authUserId = payload.sub;
      if (typeof authUserId !== 'string' || !UUID.test(authUserId)) return null;

      // Supabase only issues an email after proving the address, so a token
      // without one cannot provision or claim a customer row.
      const email = payload['email'];
      if (typeof email !== 'string' || email.trim() === '') return null;

      return { authUserId, email: email.trim().toLowerCase() };
    },
  };
}

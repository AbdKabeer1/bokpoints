import { eq } from 'drizzle-orm';
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { Database } from '../db/client.js';
import { staffUsers } from '../db/schema.js';
import { MfaRequiredError, type AuthenticatedPrincipal, type SessionResolver } from './session.js';

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

/**
 * Turns a Supabase access token into a staff principal.
 *
 * The token proves who someone is. It never says what they may do: roles
 * and store access are read from our own tables afterwards (D-098). So a
 * customer, who also has a valid Supabase token, gets nothing here, because
 * no staff account is linked to them.
 *
 * Verification is local, against the project's public keys (D-100): no call
 * to Supabase per request, and the key set is cached and refreshed when a
 * key rotates.
 */
export function createSupabaseSessionResolver(options: SupabaseResolverOptions): SessionResolver {
  const { db } = options;
  const issuer = `${options.supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  const keys = options.keys ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return {
    async resolve(token: string): Promise<AuthenticatedPrincipal | null> {
      let payload: JWTPayload;
      try {
        const verified = await jwtVerify(token, keys, {
          issuer,
          audience: 'authenticated',
          algorithms: ALGORITHMS,
        });
        payload = verified.payload;
      } catch (error) {
        // A bad, expired or forged token is a plain "no". Failing to reach
        // the key set is our problem, not the caller's, so it is not
        // reported as an invalid token: it surfaces as a server error.
        if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) {
          return null;
        }
        throw error;
      }

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

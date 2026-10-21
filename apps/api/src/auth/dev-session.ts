import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { staffUsers } from '../db/schema.js';
import type { AuthenticatedPrincipal, SessionResolver } from './session.js';

/**
 * A development-only resolver: the bearer token is the staff member's email
 * address.
 *
 * It exists so the API can be exercised end to end before Supabase is
 * chosen. It must never be enabled in production: the server would accept
 * anybody who knows a staff email address.
 *
 * Note that the token never carries a role. The role is always read from
 * `store_members` by the authorization layer, so a caller cannot promote
 * themselves by sending a different token.
 */
export function createDevSessionResolver(db: Database): SessionResolver {
  return {
    async resolve(token: string): Promise<AuthenticatedPrincipal | null> {
      const rows = await db
        .select({ id: staffUsers.id, email: staffUsers.email })
        .from(staffUsers)
        .where(sql`lower(${staffUsers.email}) = lower(${token})`)
        .limit(1);

      const found = rows[0];
      if (!found) return null;
      return { staffUserId: found.id, email: found.email };
    },
  };
}

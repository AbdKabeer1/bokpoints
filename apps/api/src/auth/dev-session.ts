import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { staffUsers } from '../db/schema.js';
import type {
  AuthenticatedPrincipal,
  CustomerPrincipal,
  CustomerSessionResolver,
  SessionResolver,
} from './session.js';

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

/**
 * A deterministic stand-in for the Supabase user id, used only by the
 * development resolver: the same email always maps to the same UUID, so
 * provisioning stays idempotent across calls in tests. It is a development
 * convenience, never a security boundary.
 */
export function uuidFromEmail(email: string): string {
  const hex = createHash('sha1').update(email.trim().toLowerCase()).digest('hex').split('');
  hex[12] = '5';
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  hex[16] = variant;

  const joined = hex.join('');
  return [
    joined.slice(0, 8),
    joined.slice(8, 12),
    joined.slice(12, 16),
    joined.slice(16, 20),
    joined.slice(20, 32),
  ].join('-');
}

/**
 * The customer-side development resolver: the bearer token is the customer's
 * email address. Like the staff one, it must never be enabled in production.
 */
export function createDevCustomerResolver(): CustomerSessionResolver {
  return {
    async resolve(token: string): Promise<CustomerPrincipal | null> {
      const email = token.trim().toLowerCase();
      if (email === '') return null;
      return { authUserId: uuidFromEmail(email), email };
    },
  };
}

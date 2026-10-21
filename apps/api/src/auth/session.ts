/**
 * The pluggable authentication layer.
 *
 * The API never trusts a token to say who someone is or what role they have.
 * A resolver turns a bearer token into a principal, and the role is always
 * read from the database afterwards (see `authorize.ts`).
 *
 * The Supabase resolver is not written yet: it is build step 3. Swapping it
 * in means implementing this one interface, and nothing else changes.
 */

export interface AuthenticatedPrincipal {
  staffUserId: string;
  email: string;
}

export interface SessionResolver {
  /**
   * Returns the principal behind a bearer token, or null when the token is
   * not valid.
   */
  resolve(token: string): Promise<AuthenticatedPrincipal | null>;
}

/**
 * The pluggable authentication layer.
 *
 * The API never trusts a token to say who someone is or what role they have.
 * A resolver turns a bearer token into a principal, and the role is always
 * read from the database afterwards (see `authorize.ts`).
 *
 * `supabase-session.ts` is the production resolver. The development resolver
 * in `dev-session.ts` is opt-in and refuses to run in production.
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

/**
 * Thrown by a resolver when the token is genuine but the person has not
 * passed multi-factor authentication (FR-AUTH-2). It is a different answer
 * from an invalid token: the app sends the person to enrol or to enter their
 * code, instead of treating them as signed out.
 */
export class MfaRequiredError extends Error {
  constructor() {
    super('Multi-factor authentication is required');
    this.name = 'MfaRequiredError';
  }
}

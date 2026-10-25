/**
 * Server-side proof that Supabase has confirmed a customer's email (D-120,
 * Way Forward 4.2).
 *
 * A Supabase access token carries no verified-email claim — checked against a
 * real token from the live project: `sub`, `email`, `aal`, `role`,
 * `session_id`, `app_metadata.provider` and nothing about confirmation. The
 * Auth Admin API does carry it as `email_confirmed_at`, so the check happens
 * here, with the project's secret key, and only at the moment provisioning
 * would create or claim a customer row.
 *
 * Everything fails closed: no secret key, an error response or a network
 * failure all mean "not verified".
 */

export interface EmailVerifierOptions {
  supabaseUrl: string;
  /** The Supabase secret key; it is only ever sent to `supabaseUrl`. */
  secretKey: string;
  fetchImpl?: typeof fetch | undefined;
}

export type EmailVerifier = (authUserId: string) => Promise<boolean>;

export function createEmailVerifier(options: EmailVerifierOptions): EmailVerifier {
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (authUserId: string): Promise<boolean> => {
    if (options.supabaseUrl === '' || options.secretKey === '') return false;

    try {
      const base = options.supabaseUrl.replace(/\/+$/, '');
      const response = await fetchImpl(
        `${base}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`,
        {
          headers: { apikey: options.secretKey, Authorization: `Bearer ${options.secretKey}` },
          // A slow Supabase must not hang a first sign-in: after five
          // seconds the check gives up and fails closed (not verified),
          // which the sign-in reports as a plain retryable error.
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) return false;

      const body = (await response.json()) as {
        user?: { email_confirmed_at?: string | null };
        email_confirmed_at?: string | null;
      };
      const confirmed = body.user?.email_confirmed_at ?? body.email_confirmed_at ?? null;
      return typeof confirmed === 'string' && confirmed !== '';
    } catch {
      return false;
    }
  };
}

/** The verifier the API uses in production, from the environment. */
export function createEmailVerifierFromEnv(): EmailVerifier {
  return createEmailVerifier({
    supabaseUrl: process.env['SUPABASE_URL'] ?? '',
    secretKey: process.env['SUPABASE_SECRET_KEY'] ?? '',
  });
}

/* ── Fresh-sign-in proof and Auth user deletion (A5) ───────────────────── */

export interface AuthAdminOptions {
  supabaseUrl: string;
  secretKey: string;
  fetchImpl?: typeof fetch | undefined;
}

export type EmailOtpVerifier = (email: string, token: string) => Promise<boolean>;
export type AuthUserDeleter = (authUserId: string) => Promise<void>;

/**
 * Verifies a fresh one-time code against Supabase Auth. The code is the
 * customer proving they still control the inbox before an irreversible
 * deletion; the API receives it, not the app's local session.
 */
export function createEmailOtpVerifier(options: AuthAdminOptions): EmailOtpVerifier {
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (email: string, token: string): Promise<boolean> => {
    if (options.supabaseUrl === '' || options.secretKey === '') return false;
    try {
      const base = options.supabaseUrl.replace(/\/+$/, '');
      const response = await fetchImpl(`${base}/auth/v1/verify`, {
        method: 'POST',
        headers: {
          apikey: options.secretKey,
          Authorization: `Bearer ${options.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, token, type: 'email' }),
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  };
}

/** Deletes the Supabase Auth user; 404 means it was already gone. */
export function createAuthUserDeleter(options: AuthAdminOptions): AuthUserDeleter {
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (authUserId: string): Promise<void> => {
    if (options.supabaseUrl === '' || options.secretKey === '') {
      throw new Error('Supabase Auth admin is not configured');
    }
    const base = options.supabaseUrl.replace(/\/+$/, '');
    const response = await fetchImpl(
      `${base}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: options.secretKey,
          Authorization: `Bearer ${options.secretKey}`,
        },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Supabase Auth user deletion failed with status ${response.status}`);
    }
  };
}

export function createEmailOtpVerifierFromEnv(): EmailOtpVerifier {
  return createEmailOtpVerifier({
    supabaseUrl: process.env['SUPABASE_URL'] ?? '',
    secretKey: process.env['SUPABASE_SECRET_KEY'] ?? '',
  });
}

export function createAuthUserDeleterFromEnv(): AuthUserDeleter {
  return createAuthUserDeleter({
    supabaseUrl: process.env['SUPABASE_URL'] ?? '',
    secretKey: process.env['SUPABASE_SECRET_KEY'] ?? '',
  });
}

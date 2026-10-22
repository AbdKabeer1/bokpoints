import { createClient } from '@supabase/supabase-js';

/**
 * The browser's Supabase client. The session is persisted, so a till keeps
 * its sign-in across a page reload; the access token is refreshed in the
 * background and read per API call.
 */
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signedInEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.email ?? null;
}

export type AssuranceLevel = 'aal1' | 'aal2' | null;

/** `aal2` means the password and the second factor are both done (D-101). */
export async function assuranceLevel(): Promise<AssuranceLevel> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return null;
  if (data.currentLevel === 'aal2') return 'aal2';
  if (data.currentLevel === 'aal1') return 'aal1';
  return null;
}

export async function existingTotpFactor(): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data.totp[0]?.id ?? null;
}

export interface TotpEnrolment {
  factorId: string;
  secret: string;
  /** The standard URI every authenticator app understands. */
  uri: string;
}

export async function enrolTotp(email: string): Promise<TotpEnrolment> {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'BOKPOINTS till',
  });
  if (error) throw error;

  const secret = data.totp.secret;
  const label = encodeURIComponent(`BOKPOINTS ${email}`);
  return {
    factorId: data.id,
    secret,
    uri: `otpauth://totp/${label}?secret=${secret}&issuer=BOKPOINTS&digits=6&period=30`,
  };
}

export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw error;
}

/** Calls the handler whenever Supabase changes the session (sign-in, refresh, out). */
export function onAuthChange(handler: () => void): () => void {
  const { data } = supabase.auth.onAuthStateChange(() => handler());
  return () => data.subscription.unsubscribe();
}

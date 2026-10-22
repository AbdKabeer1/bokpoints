/**
 * Development helper: signs a staff member in to Supabase with a password and
 * a second factor, then prints the access token to use against the API.
 *
 * Until the cashier app exists there is nothing else that can complete the
 * multi-factor step, and the API refuses staff tokens without it (D-101).
 *
 * Run with:  pnpm staff:login --email you@example.com
 *
 * It needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (from the environment or
 * the repo's .env file) and prompts for the password and the code. The first
 * time, it enrols an authenticator app and prints the secret to add to it.
 * The printed token is short-lived. Never share it or commit it.
 */
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  /* no .env file: rely on the real environment */
}

const { values } = parseArgs({ options: { email: { type: 'string' } } });
const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!values.email || !url || !publishableKey) {
  console.error(
    'Usage: pnpm staff:login --email <email>  (needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY)',
  );
  process.exit(1);
}

const supabase = createClient(url, publishableKey, { auth: { persistSession: false } });
const rl = createInterface({ input: process.stdin, output: process.stdout });

try {
  const password = process.env.STAFF_PASSWORD ?? (await rl.question('Password: '));
  const signIn = await supabase.auth.signInWithPassword({ email: values.email, password });
  if (signIn.error) throw signIn.error;

  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) throw factors.error;

  let factorId = factors.data.totp[0]?.id;
  if (!factorId) {
    const enrol = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `bokpoints-${Date.now()}`,
    });
    if (enrol.error) throw enrol.error;
    factorId = enrol.data.id;
    console.log('\nAdd this to your authenticator app, then enter the 6-digit code it shows.');
    console.log(`Secret: ${enrol.data.totp.secret}`);
    console.log(`URI:    ${enrol.data.totp.uri}\n`);
  }

  const code = (await rl.question('Code from your authenticator app: ')).trim();
  const verified = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (verified.error) throw verified.error;

  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error('No session after verification');

  console.log('\nAccess token (short-lived, keep it private):\n');
  console.log(token);
} finally {
  rl.close();
}

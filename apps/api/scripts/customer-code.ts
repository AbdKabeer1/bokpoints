import { randomUUID } from 'node:crypto';

/**
 * Prints a fresh sign-in code for a customer, without sending an email.
 *
 * Supabase's built-in mailer is rate-limited and, on a free project, only
 * delivers to the project's own team addresses — so a demo customer's code
 * never arrives. This script asks the Auth Admin API for a one-time code
 * instead. It is a demo and support tool, not a sign-in bypass: the code is
 * the same one the email would carry, it expires like any OTP, and it is
 * accepted only by the normal verify endpoint.
 *
 *   pnpm --filter @bokpoints/api customer:code [email]
 */

const url = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SECRET_KEY ?? '';
const email = (process.argv[2] ?? 'customer-demo@bk.test').trim().toLowerCase();

if (url === '' || key === '') {
  console.error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set in apps/api/.env');
  process.exit(1);
}

const response = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ type: 'magiclink', email }),
});

if (!response.ok) {
  const text = await response.text();
  console.error(`The Auth Admin API refused the request (${response.status}): ${text}`);
  process.exit(1);
}

const body = (await response.json()) as { email?: string; email_otp?: string };
if (typeof body.email_otp !== 'string') {
  console.error('No code came back. Check that email sign-in is enabled for this project.');
  process.exit(1);
}

// A little opacity rather than pretending a number is a secret.
console.log('');
console.log(`  ${email}`);
console.log(`  code: ${body.email_otp}`);
console.log(`  (valid for a short while; each new code replaces the last)`);
console.log(`  request id: ${randomUUID()}`);
console.log('');

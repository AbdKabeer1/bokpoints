/**
 * Creates the first admin account, or links an existing staff account to a
 * Supabase user.
 *
 * Steps:
 *   1. In the Supabase dashboard, Authentication > Users, create the user
 *      (email and password, marked as confirmed) and copy their User UID.
 *   2. Run:
 *        pnpm bootstrap:admin --email you@example.com --name "Your Name" \
 *          --auth-user-id <the User UID>
 *
 * It reads DATABASE_URL from the environment or apps/api/.env. Running
 * it twice with the same input changes nothing.
 */
import { parseArgs } from 'node:util';
import { createDb, createPool } from '../src/db/client.js';
import { upsertStaffAccount } from '../src/db/staff.js';

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  /* no .env file: rely on the real environment */
}

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    'auth-user-id': { type: 'string' },
    'not-admin': { type: 'boolean', default: false },
  },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const email = values.email;
const name = values.name;
const authUserId = values['auth-user-id'];

if (!email || !name || !authUserId || !UUID.test(authUserId)) {
  console.error(
    'Usage: pnpm bootstrap:admin --email <email> --name "<name>" --auth-user-id <Supabase User UID>',
  );
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Put it in .env or the environment.');
  process.exit(1);
}

const pool = createPool(process.env.DATABASE_URL);
const db = createDb(pool);

try {
  const id = await upsertStaffAccount(db, {
    email,
    name,
    authUserId,
    isAdmin: !values['not-admin'],
  });
  console.log(`Staff account ready: ${email} (id ${id}, admin: ${!values['not-admin']})`);
} finally {
  await pool.end();
}

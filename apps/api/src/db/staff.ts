import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

export interface StaffAccountInput {
  email: string;
  name: string;
  /** The user's id in Supabase Auth (D-099). */
  authUserId: string;
  isAdmin: boolean;
}

/**
 * Creates a staff account, or updates the one with the same email, and links
 * it to a Supabase user. Emails are compared case-insensitively (D-094).
 *
 * It is the one path for administrative account setup: the bootstrap script
 * uses it for the first admin, and the store-invite flow will use it later.
 * Running it twice with the same input changes nothing.
 */
export async function upsertStaffAccount(db: Database, input: StaffAccountInput): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO staff_users (email, name, is_admin, auth_user_id)
    VALUES (${input.email}, ${input.name}, ${input.isAdmin}, ${input.authUserId})
    ON CONFLICT ((lower(email))) DO UPDATE
      SET name = EXCLUDED.name,
          is_admin = EXCLUDED.is_admin,
          auth_user_id = EXCLUDED.auth_user_id
    RETURNING id
  `);

  const id = result.rows[0]?.id;
  if (!id) throw new Error('Could not create the staff account');
  return id;
}

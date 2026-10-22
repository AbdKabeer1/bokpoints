import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface StaffAccountInput {
  email: string;
  name: string;
  /** The user's id in Supabase Auth (D-099). */
  authUserId: string;
  isAdmin: boolean;
}

export class StaffAccountError extends Error {
  constructor(
    public readonly code: 'AUTH_USER_ALREADY_LINKED' | 'ALREADY_MEMBER',
    message: string,
  ) {
    super(message);
    this.name = 'StaffAccountError';
  }
}

export interface StaffInviteResult {
  userId: string;
  /** True when this call created the account; false when one already existed. */
  created: boolean;
}

/**
 * The account half of an invitation (Way Forward 4.1, D-119): it creates an
 * account only when the email is new, and when the email already exists it
 * returns that account **untouched** — an invitation can never change an
 * existing account's name, admin flag or Supabase link.
 *
 * A Supabase id that already belongs to another staff account is refused, so
 * an owner cannot point their own Supabase user at somebody else's email.
 * It accepts either the database or a transaction.
 */
export async function createStaffAccountForInvite(
  db: Database | Tx,
  input: StaffAccountInput,
): Promise<StaffInviteResult> {
  const email = input.email.trim().toLowerCase();

  const existing = await db.execute<{ id: string }>(
    sql`SELECT id FROM staff_users WHERE lower(email) = ${email} LIMIT 1`,
  );
  const existingId = existing.rows[0]?.id;

  const linked = await db.execute<{ id: string }>(
    sql`SELECT id FROM staff_users WHERE auth_user_id = ${input.authUserId} LIMIT 1`,
  );
  const linkedId = linked.rows[0]?.id;
  if (linkedId !== undefined && linkedId !== existingId) {
    throw new StaffAccountError(
      'AUTH_USER_ALREADY_LINKED',
      'That Supabase user is already linked to another staff account',
    );
  }

  if (existingId !== undefined) {
    return { userId: existingId, created: false };
  }

  const inserted = await db.execute<{ id: string }>(sql`
    INSERT INTO staff_users (email, name, is_admin, auth_user_id)
    VALUES (${email}, ${input.name}, ${input.isAdmin}, ${input.authUserId})
    RETURNING id
  `);
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error('Could not create the staff account');
  return { userId: id, created: true };
}

/**
 * The administrative setup path: it creates the account, or updates the one
 * with the same email, and links it to a Supabase user. Emails are compared
 * case-insensitively (D-094).
 *
 * It overwrites on purpose and is reserved for the bootstrap script, which
 * sets up the very first admin before anyone can sign in (D-119). Every
 * in-product path uses `createStaffAccountForInvite` instead, because an
 * overwrite there would be an account takeover (Way Forward 4.1).
 * Running it twice with the same input changes nothing. It accepts either
 * the database or a transaction, so the caller keeps its atomicity.
 */
export async function upsertStaffAccount(
  db: Database | Tx,
  input: StaffAccountInput,
): Promise<string> {
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

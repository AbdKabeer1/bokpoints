import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, createPool } from '../src/db/client.js';
import { expiryDateForEarn } from '@bokpoints/shared';

/**
 * Seeds the configured DATABASE_URL with the pilot demo: one store, its
 * program, three staff accounts linked to their Supabase identities, and one
 * customer with a balance.
 *
 * Safe to run more than once: every step looks first and only creates what is
 * missing. It never truncates and never deletes.
 *
 *   DATABASE_URL=<production pooler> pnpm --filter @bokpoints/api seed:demo
 */

const url = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const secret = process.env.SUPABASE_SECRET_KEY ?? '';

if (url === '' || secret === '') {
  console.error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
  process.exit(1);
}

interface SupabaseUser {
  id: string;
  email?: string;
}

async function listUsers(): Promise<Map<string, string>> {
  const response = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: { apikey: secret, authorization: `Bearer ${secret}` },
  });
  if (!response.ok) {
    throw new Error(`Could not list Supabase users (${response.status})`);
  }
  const body = (await response.json()) as { users?: SupabaseUser[] };
  const map = new Map<string, string>();
  for (const user of body.users ?? []) {
    if (user.email !== undefined) map.set(user.email.toLowerCase(), user.id);
  }
  return map;
}

const pool = createPool(process.env.DATABASE_URL as string);
const db = createDb(pool);

const one = async <T>(query: ReturnType<typeof sql>): Promise<T | undefined> => {
  const result = await db.execute(query);
  return result.rows[0] as T | undefined;
};

async function main(): Promise<void> {
  const users = await listUsers();
  const wanted = ['admin@bk.test', 'owner@bk.test', 'cashier@bk.test', 'customer-demo@bk.test'];
  const missing = wanted.filter((email) => !users.has(email));
  if (missing.length > 0) {
    throw new Error(`These Supabase users do not exist yet: ${missing.join(', ')}`);
  }

  for (const email of ['admin@bk.test', 'owner@bk.test', 'cashier@bk.test']) {
    const authUserId = users.get(email) as string;
    const isAdmin = email === 'admin@bk.test';
    const name =
      email === 'admin@bk.test'
        ? 'Platform Admin'
        : email === 'owner@bk.test'
          ? 'Otto Owner'
          : 'Cai Cashier';

    const existing = await one<{ id: string }>(
      sql`SELECT id FROM staff_users WHERE lower(email) = ${email}`,
    );

    if (existing === undefined) {
      await db.execute(sql`
        INSERT INTO staff_users (id, email, name, is_admin, auth_user_id, status)
        VALUES (${randomUUID()}, ${email}, ${name}, ${isAdmin}, ${authUserId}, 'active')
      `);
      console.log(`staff created: ${email}`);
    } else {
      await db.execute(sql`
        UPDATE staff_users
        SET auth_user_id = ${authUserId}, is_admin = ${isAdmin}, name = ${name}, status = 'active'
        WHERE id = ${existing.id}
      `);
      console.log(`staff linked: ${email}`);
    }
  }

  const store = await one<{ id: string }>(
    sql`SELECT id FROM stores WHERE name = 'Kahvila Bea' ORDER BY created_at LIMIT 1`,
  );
  const storeId =
    store?.id ??
    (
      await one<{ id: string }>(sql`
        INSERT INTO stores (id, name, status, plan, address, contact_name, contact_email, brand_color)
        VALUES (${randomUUID()}, 'Kahvila Bea', 'active', 'pilot',
                'Mannerheimintie 1, Helsinki', 'Otto Owner', 'owner@bk.test', '#2a6b56')
        RETURNING id
      `)
    )?.id;
  if (storeId === undefined) throw new Error('Could not create the store');
  console.log(`store: ${storeId}`);

  const rule = await one<{ id: string }>(
    sql`SELECT id FROM earning_rules WHERE store_id = ${storeId} AND status = 'active' LIMIT 1`,
  );
  if (rule === undefined) {
    await db.execute(sql`
      INSERT INTO earning_rules (store_id, type, params, conditions, effective_from, status, version)
      VALUES (${storeId}, 'per_euro',
              '{"pointsPerEuroThousandths":1000,"rounding":"floor"}'::jsonb,
              '{}'::jsonb, now() - interval '30 days', 'active', 1)
    `);
    console.log('earning rule created');
  }

  for (const reward of [
    { name: 'Free coffee', cost: 300, limit: 1 },
    { name: 'Cinnamon bun', cost: 450, limit: null },
  ]) {
    const exists = await one<{ id: string }>(
      sql`SELECT id FROM store_rewards WHERE store_id = ${storeId} AND name = ${reward.name} LIMIT 1`,
    );
    if (exists === undefined) {
      await db.execute(sql`
        INSERT INTO store_rewards (store_id, name, points_cost, per_customer_per_day_limit, active)
        VALUES (${storeId}, ${reward.name}, ${reward.cost},
                ${reward.limit}, true)
      `);
      console.log(`reward created: ${reward.name}`);
    }
  }

  for (const [email, role] of [
    ['owner@bk.test', 'owner'],
    ['cashier@bk.test', 'cashier'],
  ] as const) {
    const staff = await one<{ id: string }>(
      sql`SELECT id FROM staff_users WHERE lower(email) = ${email}`,
    );
    if (staff === undefined) continue;
    const member = await one<{ id: string }>(
      sql`SELECT id FROM store_members WHERE store_id = ${storeId} AND user_id = ${staff.id} LIMIT 1`,
    );
    if (member === undefined) {
      await db.execute(sql`
        INSERT INTO store_members (store_id, user_id, role, status)
        VALUES (${storeId}, ${staff.id}, ${role}, 'active')
      `);
      console.log(`member added: ${email} (${role})`);
    }
  }

  const customerEmail = 'customer-demo@bk.test';
  const authUserId = users.get(customerEmail) as string;
  const customer = await one<{ id: string }>(
    sql`SELECT id FROM customers WHERE lower(email) = ${customerEmail} LIMIT 1`,
  );

  const customerId =
    customer?.id ??
    (
      await one<{ id: string }>(sql`
        INSERT INTO customers (id, email, name, auth_user_id, status)
        VALUES (${randomUUID()}, ${customerEmail}, 'Demo Customer', ${authUserId}, 'active')
        RETURNING id
      `)
    )?.id;
  if (customerId === undefined) throw new Error('Could not create the customer');

  if (customer === undefined) {
    await db.execute(sql`
      UPDATE customers SET auth_user_id = ${authUserId} WHERE id = ${customerId}
    `);
  }
  console.log(`customer: ${customerId}`);

  const link = await one<{ id: string }>(
    sql`SELECT id FROM customer_store_links WHERE customer_id = ${customerId} AND store_id = ${storeId} LIMIT 1`,
  );
  if (link === undefined) {
    await db.execute(sql`
      INSERT INTO customer_store_links (customer_id, store_id, marketing_consent, status)
      VALUES (${customerId}, ${storeId}, true, 'active')
    `);
    console.log('customer linked to the store (consent on)');
  }

  const balance = await one<{ customer_id: string }>(
    sql`SELECT customer_id FROM points_balances WHERE customer_id = ${customerId} AND store_id = ${storeId} LIMIT 1`,
  );
  if (balance === undefined) {
    const earnId = randomUUID();
    const expiresAt = expiryDateForEarn(new Date());
    await db.execute(sql`
      INSERT INTO points_ledger_entries
        (id, customer_id, store_id, type, points, created_at)
      VALUES (${earnId}, ${customerId}, ${storeId}, 'earn', 120, now() - interval '9 days')
    `);
    await db.execute(sql`
      INSERT INTO points_batches
        (earn_entry_id, customer_id, store_id, original_points, remaining_points, expires_at)
      VALUES (${earnId}, ${customerId}, ${storeId}, 120, 120, ${expiresAt})
    `);
    await db.execute(sql`
      INSERT INTO points_balances (customer_id, store_id, balance)
      VALUES (${customerId}, ${storeId}, 120)
    `);
    console.log('balance seeded: 120 points');
  }

  console.log('done');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

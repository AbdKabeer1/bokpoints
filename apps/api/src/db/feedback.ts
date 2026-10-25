import { desc } from 'drizzle-orm';
import type { Database } from './client.js';
import { feedback } from './schema.js';

export type FeedbackSource = 'customer' | 'owner' | 'admin' | 'till';
export type FeedbackCategory = 'bug' | 'idea' | 'other';

export interface FeedbackInput {
  source: FeedbackSource;
  category: FeedbackCategory;
  message: string;
  page?: string | null;
  contactEmail?: string | null;
  customerId?: string | null;
  staffUserId?: string | null;
}

export async function recordFeedback(
  db: Database,
  input: FeedbackInput,
): Promise<{ id: string; createdAt: Date }> {
  const rows = await db
    .insert(feedback)
    .values({
      source: input.source,
      category: input.category,
      message: input.message,
      page: input.page ?? null,
      contactEmail: input.contactEmail ?? null,
      customerId: input.customerId ?? null,
      staffUserId: input.staffUserId ?? null,
    })
    .returning({ id: feedback.id, createdAt: feedback.createdAt });

  const row = rows[0];
  if (!row) throw new Error('Could not store the feedback');
  return row;
}

export async function listFeedback(db: Database, limit = 100) {
  return db
    .select({
      id: feedback.id,
      source: feedback.source,
      category: feedback.category,
      message: feedback.message,
      contactEmail: feedback.contactEmail,
      page: feedback.page,
      status: feedback.status,
      createdAt: feedback.createdAt,
    })
    .from(feedback)
    .orderBy(desc(feedback.createdAt))
    .limit(limit);
}

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  auditLogEntries,
  campaignDeliveries,
  campaigns,
  customerStoreLinks,
  stores,
} from './schema.js';

export interface CampaignSummary {
  id: string;
  title: string;
  body: string;
  status: string;
  recipients: number;
  opened: number;
  createdAt: Date;
}

export interface CampaignAudience {
  linked: number;
  optedIn: number;
}

export interface CustomerNotification {
  id: string;
  storeId: string;
  storeName: string;
  storeBrandColor: string | null;
  title: string;
  body: string;
  createdAt: Date;
  readAt: Date | null;
}

/**
 * A campaign reaches only customers who are linked to the store and have
 * accepted store news in the app (FR-PRV-2). Marketing consent is off by
 * default, so this is deliberately narrower than "every customer".
 */
export async function campaignAudience(
  db: Database,
  storeId: string,
): Promise<CampaignAudience> {
  const result = await db
    .select({
      linked: sql<number>`count(*)::int`,
      optedIn: sql<number>`count(*) filter (where ${customerStoreLinks.marketingConsent})::int`,
    })
    .from(customerStoreLinks)
    .where(
      and(
        eq(customerStoreLinks.storeId, storeId),
        eq(customerStoreLinks.status, 'active'),
      ),
    );

  const row = result[0];
  return { linked: Number(row?.linked ?? 0), optedIn: Number(row?.optedIn ?? 0) };
}

/**
 * Writes the campaign, delivers one copy per consenting customer and
 * records the send in the audit log. All three happen in one transaction:
 * a campaign that says it went to 40 people has 40 deliveries.
 */
export async function createAndSendCampaign(
  db: Database,
  input: {
    storeId: string;
    staffUserId: string;
    title: string;
    body: string;
  },
): Promise<CampaignSummary> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(campaigns)
      .values({
        storeId: input.storeId,
        title: input.title,
        body: input.body,
        status: 'sent',
        createdBy: input.staffUserId,
      })
      .returning({
        id: campaigns.id,
        title: campaigns.title,
        body: campaigns.body,
        status: campaigns.status,
        createdAt: campaigns.createdAt,
      });

    const campaign = inserted[0];
    if (campaign === undefined) throw new Error('The campaign was not created');

    const delivered = await tx.execute(sql`
      INSERT INTO campaign_deliveries (campaign_id, customer_id)
      SELECT ${campaign.id}, link.customer_id
      FROM customer_store_links AS link
      WHERE link.store_id = ${input.storeId}
        AND link.marketing_consent = true
        AND link.status = 'active'
      ON CONFLICT DO NOTHING
    `);

    const recipients = delivered.rowCount ?? 0;

    await tx.update(campaigns).set({ recipients }).where(eq(campaigns.id, campaign.id));

    await tx.insert(auditLogEntries).values({
      actorId: input.staffUserId,
      action: 'campaign.send',
      storeId: input.storeId,
      targetType: 'campaign',
      targetId: campaign.id,
      after: { title: input.title, recipients },
    });

    return { ...campaign, recipients, opened: 0 };
  });
}

export async function listCampaigns(
  db: Database,
  storeId: string,
  limit = 50,
): Promise<CampaignSummary[]> {
  const rows = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      body: campaigns.body,
      status: campaigns.status,
      recipients: campaigns.recipients,
      createdAt: campaigns.createdAt,
      opened:
        sql<number>`count(${campaignDeliveries.id}) filter (where ${campaignDeliveries.readAt} is not null)::int`,
    })
    .from(campaigns)
    .leftJoin(campaignDeliveries, eq(campaignDeliveries.campaignId, campaigns.id))
    .where(eq(campaigns.storeId, storeId))
    .groupBy(campaigns.id)
    .orderBy(desc(campaigns.createdAt))
    .limit(limit);

  return rows.map((row) => ({ ...row, opened: Number(row.opened ?? 0) }));
}

/** The customer's inbox: one row per delivered campaign, newest first. */
export async function customerNotifications(
  db: Database,
  customerId: string,
  limit = 50,
): Promise<{ unread: number; notifications: CustomerNotification[] }> {
  const notifications = await db
    .select({
      id: campaignDeliveries.id,
      storeId: campaigns.storeId,
      storeName: stores.name,
      storeBrandColor: stores.brandColor,
      title: campaigns.title,
      body: campaigns.body,
      createdAt: campaignDeliveries.createdAt,
      readAt: campaignDeliveries.readAt,
    })
    .from(campaignDeliveries)
    .innerJoin(campaigns, eq(campaigns.id, campaignDeliveries.campaignId))
    .innerJoin(stores, eq(stores.id, campaigns.storeId))
    .where(eq(campaignDeliveries.customerId, customerId))
    .orderBy(desc(campaignDeliveries.createdAt))
    .limit(limit);

  const unreadRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaignDeliveries)
    .where(
      and(
        eq(campaignDeliveries.customerId, customerId),
        isNull(campaignDeliveries.readAt),
      ),
    );

  return { unread: Number(unreadRows[0]?.count ?? 0), notifications };
}

/**
 * Marks one delivered campaign read. A customer can only touch their own
 * copy; an unknown id answers the same way as somebody else's.
 */
export async function markNotificationRead(
  db: Database,
  customerId: string,
  notificationId: string,
): Promise<{ id: string; readAt: Date } | null> {
  const existing = await db
    .select({ id: campaignDeliveries.id, readAt: campaignDeliveries.readAt })
    .from(campaignDeliveries)
    .where(
      and(
        eq(campaignDeliveries.id, notificationId),
        eq(campaignDeliveries.customerId, customerId),
      ),
    )
    .limit(1);

  const row = existing[0];
  if (row === undefined) return null;
  if (row.readAt !== null) return { id: row.id, readAt: row.readAt };

  const updated = await db
    .update(campaignDeliveries)
    .set({ readAt: new Date() })
    .where(eq(campaignDeliveries.id, notificationId))
    .returning({ id: campaignDeliveries.id, readAt: campaignDeliveries.readAt });

  const marked = updated[0];
  if (marked === undefined || marked.readAt === null) return null;
  return { id: marked.id, readAt: marked.readAt };
}

/**
 * Sets the customer's answer for one store's news. Doing this twice is the
 * same as doing it once.
 */
export async function setStoreConsent(
  db: Database,
  customerId: string,
  storeId: string,
  marketingConsent: boolean,
): Promise<boolean> {
  const updated = await db
    .update(customerStoreLinks)
    .set({ marketingConsent })
    .where(
      and(
        eq(customerStoreLinks.customerId, customerId),
        eq(customerStoreLinks.storeId, storeId),
      ),
    )
    .returning({ id: customerStoreLinks.id });

  return updated.length > 0;
}

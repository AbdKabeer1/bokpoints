CREATE TABLE "earning_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"rule_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"params" jsonb NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "earning_rules_type_check" CHECK ("earning_rules"."type" in ('per_euro', 'fixed_per_purchase', 'threshold_bonus')),
	CONSTRAINT "earning_rules_status_check" CHECK ("earning_rules"."status" in ('active', 'paused', 'superseded')),
	CONSTRAINT "earning_rules_version_check" CHECK ("earning_rules"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "earning_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ADD COLUMN "rules_applied" jsonb;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "max_points_per_sale" integer;--> statement-breakpoint
ALTER TABLE "earning_rules" ADD CONSTRAINT "earning_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_rules" ADD CONSTRAINT "earning_rules_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "earning_rules_store_version_unique" ON "earning_rules" USING btree ("store_id","version");--> statement-breakpoint
CREATE INDEX "earning_rules_store_status_idx" ON "earning_rules" USING btree ("store_id","status","effective_from");--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_max_points_per_sale_check" CHECK ("stores"."max_points_per_sale" is null or "stores"."max_points_per_sale" >= 0);--> statement-breakpoint
-- WP2: every existing per-euro rule becomes an earning rule, so a store that
-- was awarding before this migration keeps awarding exactly the same points.
-- The newest version per store stays active; older versions are kept as
-- superseded history (FR-RUL-4).
INSERT INTO "earning_rules" ("store_id", "rule_key", "type", "params", "conditions", "effective_from", "status", "version", "created_at")
SELECT
  p."store_id",
  gen_random_uuid(),
  'per_euro',
  jsonb_build_object(
    'pointsPerEuroThousandths', p."points_per_euro_thousandths",
    'rounding', p."rounding"
  ),
  jsonb_strip_nulls(jsonb_build_object('minSpendCents', p."min_purchase_cents")),
  p."active_from",
  CASE
    WHEN p."rule_version" = (
      SELECT max(x."rule_version") FROM "points_rules" x WHERE x."store_id" = p."store_id"
    ) THEN 'active'
    ELSE 'superseded'
  END,
  p."rule_version",
  p."created_at"
FROM "points_rules" p;
--> statement-breakpoint
-- The store's per-sale ceiling moves onto the store (FR-RUL-5).
UPDATE "stores" s
SET "max_points_per_sale" = latest."max_points_per_transaction"
FROM (
  SELECT DISTINCT ON ("store_id") "store_id", "max_points_per_transaction"
  FROM "points_rules"
  ORDER BY "store_id", "rule_version" DESC
) latest
WHERE s."id" = latest."store_id"
  AND latest."max_points_per_transaction" IS NOT NULL;

CREATE TABLE "store_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"points_cost" integer NOT NULL,
	"per_customer_per_day_limit" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_rewards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ADD COLUMN "reward_id" uuid;--> statement-breakpoint
ALTER TABLE "store_rewards" ADD CONSTRAINT "store_rewards_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_rewards_store_idx" ON "store_rewards" USING btree ("store_id");--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ADD CONSTRAINT "points_ledger_entries_reward_id_store_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."store_rewards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "points_ledger_entries_reward_idx" ON "points_ledger_entries" USING btree ("reward_id","customer_id","store_id");
CREATE TABLE "store_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_locations_id_store_unique" UNIQUE("id","store_id"),
	CONSTRAINT "store_locations_status_check" CHECK ("store_locations"."status" in ('active', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "store_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cashier_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_store_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "points_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "points_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "points_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rejected_offline_awards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "auth_user_id" uuid;--> statement-breakpoint
ALTER TABLE "store_members" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "store_locations" ADD CONSTRAINT "store_locations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_locations_store_name_unique" ON "store_locations" USING btree ("store_id","name");--> statement-breakpoint
CREATE INDEX "store_locations_store_idx" ON "store_locations" USING btree ("store_id");--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ADD CONSTRAINT "points_ledger_entries_location_store_fk" FOREIGN KEY ("location_id","store_id") REFERENCES "public"."store_locations"("id","store_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_location_store_fk" FOREIGN KEY ("location_id","store_id") REFERENCES "public"."store_locations"("id","store_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_users_auth_user_unique" ON "staff_users" USING btree ("auth_user_id");
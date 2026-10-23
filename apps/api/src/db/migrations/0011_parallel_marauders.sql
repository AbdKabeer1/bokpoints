CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"location_id" uuid,
	"customer_id" uuid NOT NULL,
	"staff_id" uuid,
	"device_id" uuid,
	"amount_before_discount_cents" integer NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"amount_paid_cents" integer NOT NULL,
	"rules_applied" jsonb,
	"pos_reference" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "points_ledger_entries" DROP CONSTRAINT "points_ledger_entries_points_sign";--> statement-breakpoint
ALTER TABLE "points_ledger_entries" DROP CONSTRAINT "points_ledger_entries_type_check";--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ADD COLUMN "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ADD COLUMN "reversal_of" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_location_id_store_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."store_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_device_id_cashier_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."cashier_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_store_idempotency_unique" ON "sales" USING btree ("store_id","customer_id","idempotency_key") WHERE "sales"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "sales_customer_store_idx" ON "sales" USING btree ("customer_id","store_id");--> statement-breakpoint
CREATE INDEX "sales_created_idx" ON "sales" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ADD CONSTRAINT "points_ledger_entries_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ADD CONSTRAINT "points_ledger_entries_reversal_of_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."points_ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "points_ledger_entries_sale_idx" ON "points_ledger_entries" USING btree ("sale_id");--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ADD CONSTRAINT "points_ledger_entries_points_sign" CHECK (("points_ledger_entries"."type" = 'earn' and "points_ledger_entries"."points" >= 0) or "points_ledger_entries"."type" = 'adjust' or ("points_ledger_entries"."type" in ('redeem', 'expire', 'fraud_clawback', 'reversal') and "points_ledger_entries"."points" <= 0));--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ADD CONSTRAINT "points_ledger_entries_type_check" CHECK ("points_ledger_entries"."type" in ('earn', 'redeem', 'adjust', 'expire', 'fraud_clawback', 'reversal'));
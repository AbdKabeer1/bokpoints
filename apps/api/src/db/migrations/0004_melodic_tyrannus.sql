CREATE TABLE "points_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"earn_entry_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"original_points" integer NOT NULL,
	"remaining_points" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_batches_earn_entry_id_unique" UNIQUE("earn_entry_id"),
	CONSTRAINT "points_batches_remaining_check" CHECK ("points_batches"."remaining_points" >= 0 and "points_batches"."remaining_points" <= "points_batches"."original_points")
);
--> statement-breakpoint
ALTER TABLE "points_ledger_entries" DROP CONSTRAINT "points_ledger_entries_remaining";--> statement-breakpoint
DROP INDEX "customers_email_unique";--> statement-breakpoint
DROP INDEX "staff_users_email_unique";--> statement-breakpoint
ALTER TABLE "points_batches" ADD CONSTRAINT "points_batches_earn_entry_id_points_ledger_entries_id_fk" FOREIGN KEY ("earn_entry_id") REFERENCES "public"."points_ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_batches" ADD CONSTRAINT "points_batches_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_batches" ADD CONSTRAINT "points_batches_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "points_batches_expiry_idx" ON "points_batches" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "points_batches_customer_store_idx" ON "points_batches" USING btree ("customer_id","store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_email_unique" ON "customers" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "staff_users_email_unique" ON "staff_users" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "points_ledger_entries" DROP COLUMN "remaining_points";
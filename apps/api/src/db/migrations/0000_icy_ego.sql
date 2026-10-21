CREATE TABLE "audit_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"store_id" uuid,
	"target_type" text,
	"target_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cashier_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"registered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashier_devices_status_check" CHECK ("cashier_devices"."status" in ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" text NOT NULL,
	"identifier" text NOT NULL,
	"device_public_key" text,
	"valid_until" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_type_check" CHECK ("credentials"."type" in ('app_qr', 'nfc_card', 'wallet_pass')),
	CONSTRAINT "credentials_status_check" CHECK ("credentials"."status" in ('active', 'lost', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "customer_store_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "customer_store_links_status_check" CHECK ("customer_store_links"."status" in ('active', 'under_fraud_review'))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email_verified_at" timestamp with time zone,
	"language" text DEFAULT 'fi' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_status_check" CHECK ("customers"."status" in ('active', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "points_balances" (
	"customer_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_balances_customer_id_store_id_pk" PRIMARY KEY("customer_id","store_id")
);
--> statement-breakpoint
CREATE TABLE "points_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"type" text NOT NULL,
	"points" integer NOT NULL,
	"amount_cents" integer,
	"remaining_points" integer,
	"expires_at" timestamp with time zone,
	"rule_version" integer,
	"reason" text,
	"staff_id" uuid,
	"device_id" uuid,
	"scanned_at" timestamp with time zone,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_ledger_entries_points_sign" CHECK ("points_ledger_entries"."points" >= 0 or "points_ledger_entries"."type" = 'fraud_clawback'),
	CONSTRAINT "points_ledger_entries_remaining" CHECK ("points_ledger_entries"."remaining_points" is null or ("points_ledger_entries"."remaining_points" >= 0 and "points_ledger_entries"."remaining_points" <= "points_ledger_entries"."points")),
	CONSTRAINT "points_ledger_entries_type_check" CHECK ("points_ledger_entries"."type" in ('earn', 'redeem', 'adjust', 'expire', 'fraud_clawback'))
);
--> statement-breakpoint
CREATE TABLE "points_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"rule_version" integer NOT NULL,
	"points_per_euro_thousandths" integer NOT NULL,
	"min_purchase_cents" integer,
	"max_points_per_transaction" integer,
	"rounding" text DEFAULT 'floor' NOT NULL,
	"active_from" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_rules_rate_check" CHECK ("points_rules"."points_per_euro_thousandths" > 0),
	CONSTRAINT "points_rules_min_purchase_check" CHECK ("points_rules"."min_purchase_cents" is null or "points_rules"."min_purchase_cents" >= 0),
	CONSTRAINT "points_rules_max_points_check" CHECK ("points_rules"."max_points_per_transaction" is null or "points_rules"."max_points_per_transaction" >= 0),
	CONSTRAINT "points_rules_rounding_check" CHECK ("points_rules"."rounding" in ('floor', 'nearest'))
);
--> statement-breakpoint
CREATE TABLE "rejected_offline_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"device_id" uuid,
	"customer_id" uuid,
	"amount_cents" integer NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_status_check" CHECK ("staff_users"."status" in ('active', 'deactivated'))
);
--> statement-breakpoint
CREATE TABLE "store_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_members_role_check" CHECK ("store_members"."role" in ('owner', 'manager', 'cashier')),
	CONSTRAINT "store_members_status_check" CHECK ("store_members"."status" in ('active', 'deactivated'))
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"business_id" text,
	"address" text,
	"contact_name" text,
	"contact_email" text,
	"vat_id" text,
	"status" text DEFAULT 'invited' NOT NULL,
	"plan" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_status_check" CHECK ("stores"."status" in ('invited', 'setup', 'active', 'paused', 'suspended', 'offboarded'))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"plan" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"first_failed_payment_at" timestamp with time zone,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('trialing', 'active', 'past_due', 'paused', 'suspended', 'canceled'))
);
--> statement-breakpoint
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_devices" ADD CONSTRAINT "cashier_devices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_devices" ADD CONSTRAINT "cashier_devices_registered_by_staff_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_store_links" ADD CONSTRAINT "customer_store_links_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_store_links" ADD CONSTRAINT "customer_store_links_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_balances" ADD CONSTRAINT "points_balances_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_balances" ADD CONSTRAINT "points_balances_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ADD CONSTRAINT "points_ledger_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ADD CONSTRAINT "points_ledger_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ADD CONSTRAINT "points_ledger_entries_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger_entries" ADD CONSTRAINT "points_ledger_entries_device_id_cashier_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."cashier_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_rules" ADD CONSTRAINT "points_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejected_offline_awards" ADD CONSTRAINT "rejected_offline_awards_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejected_offline_awards" ADD CONSTRAINT "rejected_offline_awards_device_id_cashier_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."cashier_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejected_offline_awards" ADD CONSTRAINT "rejected_offline_awards_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejected_offline_awards" ADD CONSTRAINT "rejected_offline_awards_reviewed_by_staff_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_user_id_staff_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entries_store_idx" ON "audit_log_entries" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "audit_log_entries_created_idx" ON "audit_log_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cashier_devices_store_idx" ON "cashier_devices" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_type_identifier_unique" ON "credentials" USING btree ("type","identifier");--> statement-breakpoint
CREATE INDEX "credentials_customer_idx" ON "credentials" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_store_links_customer_store_unique" ON "customer_store_links" USING btree ("customer_id","store_id");--> statement-breakpoint
CREATE INDEX "customer_store_links_store_idx" ON "customer_store_links" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_email_unique" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_entries_idempotency_unique" ON "points_ledger_entries" USING btree ("store_id","idempotency_key") WHERE "points_ledger_entries"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "points_ledger_entries_customer_store_idx" ON "points_ledger_entries" USING btree ("customer_id","store_id");--> statement-breakpoint
CREATE INDEX "points_ledger_entries_created_idx" ON "points_ledger_entries" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "points_rules_store_version_unique" ON "points_rules" USING btree ("store_id","rule_version");--> statement-breakpoint
CREATE INDEX "points_rules_store_idx" ON "points_rules" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "rejected_offline_awards_store_idx" ON "rejected_offline_awards" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_users_email_unique" ON "staff_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "store_members_store_user_unique" ON "store_members" USING btree ("store_id","user_id");--> statement-breakpoint
CREATE INDEX "store_members_store_idx" ON "store_members" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_store_unique" ON "subscriptions" USING btree ("store_id");
-- The ledger and the audit log are append-only. This is a product
-- invariant, not a convention, so the database refuses the write even if
-- application code is wrong (FR-AUD-2, FRD section 3).
CREATE OR REPLACE FUNCTION prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER points_ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON points_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER audit_log_entries_append_only
  BEFORE UPDATE OR DELETE ON audit_log_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TABLE "consumed_discount_proofs" (
	"jti" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"sale_id" uuid,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consumed_discount_proofs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discount_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"threshold_cents" integer NOT NULL,
	"kind" text NOT NULL,
	"value" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discount_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consumed_discount_proofs" ADD CONSTRAINT "consumed_discount_proofs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumed_discount_proofs" ADD CONSTRAINT "consumed_discount_proofs_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_rules_store_unique" ON "discount_rules" USING btree ("store_id");
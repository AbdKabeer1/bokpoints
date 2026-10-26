CREATE TABLE "business_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"osm_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"address" text,
	"website" text,
	"phone" text,
	"opening_hours" text,
	"latitude" double precision,
	"longitude" double precision,
	"distance_km" double precision,
	"status" text DEFAULT 'invited' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_leads_status_check" CHECK ("business_leads"."status" in ('invited', 'contacted', 'joined', 'declined'))
);
--> statement-breakpoint
ALTER TABLE "business_leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "business_leads" ADD CONSTRAINT "business_leads_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_leads" ADD CONSTRAINT "business_leads_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_leads_store_osm_unique" ON "business_leads" USING btree ("store_id","osm_id");--> statement-breakpoint
CREATE INDEX "business_leads_store_idx" ON "business_leads" USING btree ("store_id","created_at");
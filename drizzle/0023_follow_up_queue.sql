CREATE TABLE IF NOT EXISTS "follow_up_queue_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bd_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"queue_date" date NOT NULL,
	"position" integer NOT NULL,
	"due_status" text NOT NULL,
	"last_touch_at" timestamp NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"snoozed_until" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "follow_up_queue_item_bd_date_person_unique" UNIQUE("bd_id","queue_date","person_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follow_up_queue_item" ADD CONSTRAINT "follow_up_queue_item_bd_id_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."bd"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follow_up_queue_item" ADD CONSTRAINT "follow_up_queue_item_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follow_up_queue_item_bd_date_idx" ON "follow_up_queue_item" USING btree ("bd_id","queue_date");
--> statement-breakpoint
-- Close the anon/authenticated PostgREST gap on this new table (same rule as
-- drizzle/0019_enable_rls.sql — the app connects as `postgres`, which owns
-- this table and has BYPASSRLS, so this is invisible to the app itself).
-- Revert: ALTER TABLE public.follow_up_queue_item DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."follow_up_queue_item" ENABLE ROW LEVEL SECURITY;
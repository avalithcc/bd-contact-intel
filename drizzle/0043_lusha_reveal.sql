-- lusha-reveal, PR 3: the Lusha reveal ledger. Nothing reads or writes the table yet (see tests/unit/lushaInert.test.ts);
-- it stays empty until the ledger write path lands in PR 4. Additive only: one new table, no existing table touched.
--
-- One row per paid or attempted Lusha event (search, email reveal, phone reveal). It is the never-pay-twice cache, the
-- input to the daily credit cap (sum(credits_charged) over "at", never Lusha's eventually consistent balance) and the
-- spend audit trail. state: reserved (in flight) | settled | failed (keeps its reserved amount counting). outcome:
-- search matched | no_match | match_rejected, reveal revealed | no_value | compliance_restricted. field, state and
-- outcome are free text validated at the write boundary (repo convention, no CHECK).
--
-- search_id ties a field row to the search row that produced it, so a re-search never reads a stale row. It is NULL on
-- a search row (readers use coalesce(search_id, id)). payload keeps the raw Lusha data: canReveal with prices on a
-- search row, the raw emails[]/phones[] on a reveal row (the phone response shape is unmeasured, D17).
-- "at" is the RESERVATION time, so a settle that crosses midnight never moves a charge to another day.
--
-- The only unique index is PARTIAL on in-flight rows: one reserved row per (person, field) is the double-click guard;
-- settled rows are unlimited (a retry after no_match / no_value / rejection is a new row).
--
-- RLS is enabled with NO policies, the posture of 0019_enable_rls.sql, 0040 and 0042: the app connects as `postgres`
-- (owner, BYPASSRLS), so only anon/authenticated are denied. Rollback: 0043_lusha_reveal_rollback.sql.
CREATE TABLE IF NOT EXISTS "lusha_reveal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"search_id" uuid,
	"field" text NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"outcome" text,
	"value" text,
	"value_normalized" text,
	"credits_reserved" integer NOT NULL,
	"credits_charged" integer,
	"lusha_contact_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_bd_id" uuid,
	"rejected_by_bd_id" uuid,
	"rejected_at" timestamp with time zone,
	"error_code" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lusha_reveal" ADD CONSTRAINT "lusha_reveal_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lusha_reveal" ADD CONSTRAINT "lusha_reveal_search_id_lusha_reveal_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."lusha_reveal"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lusha_reveal" ADD CONSTRAINT "lusha_reveal_actor_bd_id_bd_id_fk" FOREIGN KEY ("actor_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lusha_reveal" ADD CONSTRAINT "lusha_reveal_rejected_by_bd_id_bd_id_fk" FOREIGN KEY ("rejected_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lusha_reveal_in_flight_unique" ON "lusha_reveal" USING btree ("person_id","field") WHERE "lusha_reveal"."state" = 'reserved';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lusha_reveal_person_field_at_idx" ON "lusha_reveal" USING btree ("person_id","field","at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lusha_reveal_at_idx" ON "lusha_reveal" USING btree ("at");
--> statement-breakpoint
ALTER TABLE "public"."lusha_reveal" ENABLE ROW LEVEL SECURITY;

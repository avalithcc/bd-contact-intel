-- company_absorption_proposal: a BD's suggestion that one company was absorbed by (or renamed into) another.
--
-- A proposal is only a suggestion for the owner. The merge itself (scripts/merge-companies.ts) stays owner-only,
-- repoints 14 tables and has no row-by-row undo; this table never drives it. scripts/merge-companies.ts only
-- REPORTS which of its explicit groups match an open proposal and marks those 'applied' in its own transaction.
--
-- status is free text ('open' | 'applied' | 'rejected'), validated in src/lib/companies/absorption.ts: no CHECK,
-- the repo convention (relationship_stage, client_status, contact_type).
--
-- ON DELETE, deliberately different per side. Migration 0039 gave company_alias.company_key ON DELETE CASCADE
-- because an alias to a deleted company is meaningless; that reasoning holds for ONE side here, not both:
--   * survivor_company_key  CASCADE   the survivor is the company that must keep existing. If it is deleted the
--     proposal points at nothing and is meaningless, exactly the alias case.
--   * absorbed_company_key  SET NULL  the absorbed company is the one a merge DELETES. CASCADE would erase the
--     proposal the instant the merge it describes succeeds, so the 'applied' status could never be observed and
--     the history would vanish; NO ACTION would make the merge's own delete fail. SET NULL keeps the row as a
--     resolved record; absorbed_display_name (snapshot at proposal time) keeps it readable. The merge marks the
--     row applied BEFORE it deletes the company, in the same transaction.
-- Consequence: an OPEN proposal whose absorbed company was deleted by some other path ends with a NULL key. It is
-- harmless: reads join on both keys, and a NULL never collides in the unique index below.
-- proposed_by_bd_id / resolved_by_bd_id use the default NO ACTION: a bd who proposed something is never deleted
-- out from under the record of it.
--
-- company_absorption_proposal_open_absorbed_idx is the database half of "one open proposal per absorbed company":
-- the write path checks first, and this closes the race between two BDs proposing at the same moment.
--
-- No constraint is dropped here, so nothing needs the catalog-row targeting 0039 used. Additive only; rollback in
-- 0040_company_absorption_proposal_rollback.sql.
CREATE TABLE IF NOT EXISTS "company_absorption_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"absorbed_company_key" text,
	"absorbed_display_name" text NOT NULL,
	"survivor_company_key" text NOT NULL,
	"proposed_by_bd_id" uuid NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by_bd_id" uuid,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_absorption_proposal" ADD CONSTRAINT "company_absorption_proposal_absorbed_company_key_company_company_key_fk" FOREIGN KEY ("absorbed_company_key") REFERENCES "public"."company"("company_key") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_absorption_proposal" ADD CONSTRAINT "company_absorption_proposal_survivor_company_key_company_company_key_fk" FOREIGN KEY ("survivor_company_key") REFERENCES "public"."company"("company_key") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_absorption_proposal" ADD CONSTRAINT "company_absorption_proposal_proposed_by_bd_id_bd_id_fk" FOREIGN KEY ("proposed_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_absorption_proposal" ADD CONSTRAINT "company_absorption_proposal_resolved_by_bd_id_bd_id_fk" FOREIGN KEY ("resolved_by_bd_id") REFERENCES "public"."bd"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_absorption_proposal_open_absorbed_idx" ON "company_absorption_proposal" USING btree ("absorbed_company_key") WHERE "company_absorption_proposal"."status" = 'open';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_absorption_proposal_survivor_idx" ON "company_absorption_proposal" USING btree ("survivor_company_key");
--> statement-breakpoint
-- Close the anon/authenticated PostgREST gap on this new table (same rule as drizzle/0019_enable_rls.sql: the app
-- connects as `postgres`, which owns the table and has BYPASSRLS). Revert: ALTER TABLE public.company_absorption_proposal DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."company_absorption_proposal" ENABLE ROW LEVEL SECURITY;

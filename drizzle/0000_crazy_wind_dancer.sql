-- This is the first migration file ever generated for this project. The `bd`
-- and `contact` tables predate it: they were created with `drizzle-kit push`
-- during earlier development, so this migration was hand-written as an
-- incremental ALTER rather than the raw `drizzle-kit generate` output.
--
-- That left the chain with no genesis, and `npm run db:migrate` against an
-- empty database died on the first statement with `PostgresError: relation
-- "contact" does not exist` (42P01) — there was no tested path from an empty
-- database to the current schema. The baseline block below closes that gap: it
-- recreates `bd` and `contact` exactly as drizzle/meta/0000_snapshot.json
-- records them, minus `role_group` and its index, which this migration adds
-- itself further down.
--
-- Every statement is `IF NOT EXISTS` / `duplicate_object`-guarded, so this
-- block is a no-op on any database that already has the two tables. It is also
-- unreachable in production: the migrator applies an entry only when its
-- journal `when` exceeds the latest applied `created_at`
-- (node_modules/drizzle-orm/pg-core/dialect.js, PgDialect.migrate), and this
-- entry's `when` is the lowest in the chain. The file hash is stored in
-- `drizzle.__drizzle_migrations` but never compared, so editing this file
-- cannot change what an existing database replays.
CREATE TABLE IF NOT EXISTS "bd" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bd_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bd_id" uuid NOT NULL,
	"profile_key" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"company" text,
	"position" text,
	"email" text,
	"industry" text,
	"connected_on" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contact_bd_profile_unique" UNIQUE("bd_id","profile_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact" ADD CONSTRAINT "contact_bd_id_bd_id_fk" FOREIGN KEY ("bd_id") REFERENCES "public"."bd"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_bd_idx" ON "contact" USING btree ("bd_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_bd_company_idx" ON "contact" USING btree ("bd_id","company");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_bd_position_idx" ON "contact" USING btree ("bd_id","position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_profile_key_idx" ON "contact" USING btree ("profile_key");
--> statement-breakpoint
-- Adds `role_group`: a deterministic classification of `contact.position`
-- into a coarse role bucket (see src/lib/roleGroups.ts), computed at
-- import/backfill time. Existing rows are NULL until the backfill script
-- (scripts/backfill-role-groups.ts) is run — see that file for instructions.
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "role_group" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_bd_role_group_idx" ON "contact" USING btree ("bd_id","role_group");

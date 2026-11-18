-- tender owner: who is working each tender, so the 08:30 digest has somebody to warn before the deadline.
-- ADDITIVE ONLY: one nullable column on `tender`, no default, no backfill. NO DATA IS WRITTEN HERE: every existing tender
-- reads as "nobody owns it", which the digest treats as "warn every BD" until someone takes it from its ficha.
-- ON DELETE SET NULL: deleting a BD releases their tenders instead of blocking the delete or deleting the tender.
-- Deploy order: apply this BEFORE the code that reads the column; old code never references it.
-- Rerun-safe: IF NOT EXISTS makes a second run a no-op (and the constraint is added only when the column was).
-- Rollback: 0069_tender_owner_rollback.sql (deploy the code that no longer declares the column first).
ALTER TABLE "tender" ADD COLUMN IF NOT EXISTS "owner_bd_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender" ADD CONSTRAINT "tender_owner_bd_id_bd_id_fk" FOREIGN KEY ("owner_bd_id") REFERENCES "public"."bd"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

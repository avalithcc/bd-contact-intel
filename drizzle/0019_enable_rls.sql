-- Close the public data API: enable Row Level Security on every public table.
--
-- Found 2026-09-29: all 31 public tables had RLS off, and the `anon` role
-- (whose key ships in the browser bundle as NEXT_PUBLIC_SUPABASE_ANON_KEY) held
-- SELECT, INSERT, UPDATE, DELETE and TRUNCATE on every one of them, so anyone
-- could read or delete the CRM through PostgREST without signing in.
--
-- RLS with NO policies denies `anon` and `authenticated` entirely. The app is
-- unaffected: it connects as `postgres`, which owns these tables and has
-- BYPASSRLS, and it never reads data through supabase-js or PostgREST.
--
-- The default-privileges revoke stops tables created later by `postgres`
-- (future migrations, the dashboard) from being granted to `anon` and
-- `authenticated` automatically, which is how these grants got here.
--
-- Revert, per table: ALTER TABLE public.<name> DISABLE ROW LEVEL SECURITY;
-- and: ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER TABLE "public"."activity" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."bd" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."board_candidate" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."company" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."company_alias" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."company_category" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."company_probe" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."company_property_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."contact" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."conversation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."discovery_run" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."duplicate_candidate" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."email_account" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."email_domain_check" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."job_posting" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."lead" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."lead_source" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."linkedin_scrape_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."merge_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."message" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."migration_run" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."person" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."person_bd_connection" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."person_id_map" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."person_property_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."saved_view" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."signal" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."sync_run" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."target_company" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."task" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

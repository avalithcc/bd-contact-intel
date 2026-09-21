CREATE TABLE IF NOT EXISTS "email_domain_check" (
	"domain" text PRIMARY KEY NOT NULL,
	"has_mx" boolean NOT NULL,
	"provider" text NOT NULL,
	"mx_hosts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL
);

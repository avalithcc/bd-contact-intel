/**
 * The environment `npm run dev` gives the Next dev server (scripts/dev.ts).
 *
 * Next never overrides a variable already present in the server's process
 * environment, even with an empty value, so every key defined in a dotenv file
 * is blanked here and only an explicit set is given a value. A secret added to
 * `.env.local` tomorrow is therefore neutralised without touching this file.
 *
 * Nothing below is a secret: the anon key is the public demo key that ships
 * with every local Supabase install (same one as tests/e2e/local-supabase.env.example).
 */

type Env = Record<string, string | undefined>;

export const LOCAL_DEV_DATABASE_URL = "postgres://localhost:5432/bd_contact_intel_dev";
export const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
export const LOCAL_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

/**
 * Keys kept as the dotenv files define them: AI Gateway access (drafting needs
 * it) and the timezone. Everything else that reaches an external account
 * (Gmail token key, Google OAuth, cron/ingest secrets, Lusha, SMTP) is blanked.
 */
export const DEV_PASSTHROUGH_KEYS = ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "TZ"] as const;

/** Explicit local values. They win over the shell and every dotenv file. */
export function localDevOverrides(): Record<string, string> {
  return {
    DATABASE_URL: LOCAL_DEV_DATABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: LOCAL_SUPABASE_ANON_KEY,
  };
}

/** Blank every dotenv key except the passthrough ones, then apply the local overrides. Pure. */
export function buildLocalDevEnv(dotenvKeys: readonly string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of dotenvKeys) {
    if (!(DEV_PASSTHROUGH_KEYS as readonly string[]).includes(key)) env[key] = "";
  }
  return { ...env, ...localDevOverrides() };
}

/** Shell variables a stale `vercel env run` / export could leave behind; blanked too. */
export function shellLeakKeys(shell: Env): string[] {
  const risky = /^(DATABASE_URL|SUPABASE_|NEXT_PUBLIC_SUPABASE_|GMAIL_|GOOGLE_|CRON_SECRET|LEADS_|LUSHA_|SMTP_|POSTGRES_|VERCEL_ENV)/;
  return Object.keys(shell).filter((k) => risky.test(k));
}

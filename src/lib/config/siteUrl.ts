/**
 * Single base-URL resolver for links that leave the app (currently: the task
 * digest email). `passwordReset.ts`'s doc comment already names
 * `https://bd-contact-intel.vercel.app` as the live Supabase Site URL, so
 * that's the fallback here too — this file exists so a future preview/staging
 * deployment can override it via `NEXT_PUBLIC_SITE_URL` instead of every call
 * site hard-coding the production domain.
 */
const PRODUCTION_SITE_URL = "https://bd-contact-intel.vercel.app";

/** Pure form, for testing without reading `process.env` directly. */
export function resolveSiteUrl(env: Record<string, string | undefined>): string {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return PRODUCTION_SITE_URL;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export function getSiteUrl(): string {
  return resolveSiteUrl(process.env);
}

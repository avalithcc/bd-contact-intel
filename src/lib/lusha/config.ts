// Single resolver for "may Lusha be used here". Lusha spends real money, so it
// is enabled only in Vercel production with the server-side key present.
// NODE_ENV is deliberately not used: preview deploys also run with
// NODE_ENV=production. Reports variable names only, never values, and never
// throws (same contract as getGmailOAuthConfig).

export interface LushaConfig {
  apiKey: string;
}

export type LushaConfigResult =
  | { ok: true; config: LushaConfig }
  | { ok: false; reason: "not_production" }
  | { ok: false; reason: "missing_env"; missing: string[] };

const API_KEY_VAR = "LUSHA_API_KEY";

export function getLushaConfig(env: Record<string, string | undefined> = process.env): LushaConfigResult {
  if (env.VERCEL_ENV !== "production") return { ok: false, reason: "not_production" };
  const apiKey = (env[API_KEY_VAR] ?? "").trim();
  if (apiKey === "") return { ok: false, reason: "missing_env", missing: [API_KEY_VAR] };
  return { ok: true, config: { apiKey } };
}

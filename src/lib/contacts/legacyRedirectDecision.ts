/**
 * Pure decision behind the `/leads/[id]` and `/contact/[id]` redirects (task
 * 11.4; design D8). Kept free of any DB import — same rationale as
 * src/lib/auth/adminRole.ts — so it can be unit-tested without
 * DATABASE_URL. The DB-backed wrapper lives in
 * src/lib/contacts/legacyRedirect.ts.
 */
export type LegacyRedirectDecision = { kind: "not_found" } | { kind: "resolve"; personId: string };

/** Decides from a `person_id_map.person_id` value alone (no DB). */
export function decideLegacyRedirectFromMap(mapPersonId: string | null | undefined): LegacyRedirectDecision {
  if (!mapPersonId) return { kind: "not_found" };
  return { kind: "resolve", personId: mapPersonId };
}

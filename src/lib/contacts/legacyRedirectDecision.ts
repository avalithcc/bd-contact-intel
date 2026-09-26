/**
 * Pure decision behind the `/leads/[id]` and `/contact/[id]` redirects (task
 * 11.4; design D8). Kept free of any DB import — same rationale as
 * src/lib/auth/adminRole.ts — so it can be unit-tested without
 * DATABASE_URL. The DB-backed wrapper lives in
 * src/lib/contacts/legacyRedirect.ts.
 */
import { isUuid } from "@/lib/uuid";

export type LegacyRedirectDecision = { kind: "not_found" } | { kind: "resolve"; personId: string };

/** Decides from a `person_id_map.person_id` value alone (no DB). */
export function decideLegacyRedirectFromMap(mapPersonId: string | null | undefined): LegacyRedirectDecision {
  if (!mapPersonId) return { kind: "not_found" };
  return { kind: "resolve", personId: mapPersonId };
}

/**
 * `legacyId` (`person_id_map.legacy_id`) is a `uuid` column (fresh-review
 * WARNING fix). A malformed route param must be rejected BEFORE it ever
 * reaches a `where(eq(personIdMap.legacyId, legacyId))` query, or Postgres
 * throws an uncaught "invalid input syntax for type uuid" instead of a
 * handled 404.
 */
export function isValidLegacyId(legacyId: string): boolean {
  return isUuid(legacyId);
}

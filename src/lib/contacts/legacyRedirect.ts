/**
 * `/leads/[id]` and `/contact/[id]` redirects (task 11.4; design D8;
 * contact-record spec "Legacy route redirects"): both pages look up the
 * legacy id in `person_id_map`, then redirect to the unified
 * `/contacts/[id]` record, following the merge chain (contact-identity
 * spec — a redirect target can itself have been merged away since).
 * Own-company rows (`person_id` null) and legacy ids with no map row at all
 * both answer 404 (design D8: "the redirect answers those with a 404").
 * The pure decision (mapPersonId -> resolve/not_found) is
 * src/lib/contacts/legacyRedirectDecision.ts, unit-tested without a DB.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { personIdMap } from "@/db/schema";
import { resolveSurvivor } from "@/lib/contacts/queries";
import { decideLegacyRedirectFromMap, isValidLegacyId } from "@/lib/contacts/legacyRedirectDecision";

export type { LegacyRedirectDecision } from "@/lib/contacts/legacyRedirectDecision";
export type LegacyTable = "lead" | "contact";

/**
 * Resolves a legacy `(table, id)` pair to the live `/contacts/[id]` target,
 * or `null` if the caller should answer 404.
 */
export async function resolveLegacyRedirectTarget(legacyTable: LegacyTable, legacyId: string): Promise<string | null> {
  if (!isValidLegacyId(legacyId)) return null;

  const [row] = await db
    .select({ personId: personIdMap.personId })
    .from(personIdMap)
    .where(and(eq(personIdMap.legacyTable, legacyTable), eq(personIdMap.legacyId, legacyId)));

  const decision = decideLegacyRedirectFromMap(row?.personId);
  if (decision.kind === "not_found") return null;

  const survivor = await resolveSurvivor(decision.personId);
  return survivor ? survivor.id : null;
}

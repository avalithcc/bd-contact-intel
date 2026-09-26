import { redirect } from "next/navigation";
import { buildContactsRedirectQuery, type LegacyLeadsQuery } from "@/lib/contacts/legacyLeadsRedirect";

export const dynamic = "force-dynamic";

/**
 * Redirects to `/contacts?view=...` (task 13.3; contact-record spec "Legacy
 * route redirects"). The parity inventory recorded across this and the
 * prior apply-progress batch found every `/leads` feature now has a
 * `/contacts` equivalent: CSV upload (`/contacts/import`), pagination,
 * board-by-status (redesigned, not dropped — Phase 10/14.1), industryGroup/
 * seniority/owner-by-specific-BD/granular-emailStatus/ad-hoc-status filters,
 * a Seniority column, AI-drafted email ("Generar mensaje" on the record
 * page), manual signal paste, and single-record owner reassignment. Filters
 * carry over via query params where they map (buildContactsRedirectQuery);
 * `name`/`company` collapse into the combined `q` search (a superset, not a
 * narrower filter — see that function's doc comment).
 *
 * `/leads/[id]` stays a separate redirect (task 11.4, unchanged by this
 * page) — this page only replaces the list.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<LegacyLeadsQuery>;
}) {
  const sp = await searchParams;
  redirect(`/contacts?${buildContactsRedirectQuery(sp)}`);
}

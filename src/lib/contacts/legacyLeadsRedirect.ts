/**
 * Pure query mapper for the `/leads` -> `/contacts?view=...` redirect (task
 * 13.3: every feature the parity inventory tracked now has a `/contacts`
 * equivalent — industryGroup/seniority/owner-by-specific-BD/granular
 * emailStatus filters, seniority column, single-record owner reassignment,
 * ad-hoc status picker). No I/O — `/leads/page.tsx` calls `redirect()` with
 * this string; separately testable from the routing/redirect mechanics.
 *
 * `name`/`company` (separate fields on `/leads`) collapse into `/contacts`'s
 * one combined `q` search — a strict superset (searches name, company AND
 * email in one field), not a narrower filter, so nothing is lost.
 */
import { isEmailStatusKey, isLeadStatusKey } from "@/lib/leads/types";
import { isUuid } from "@/lib/uuid";

export interface LegacyLeadsQuery {
  name?: string;
  company?: string;
  industryGroup?: string;
  seniority?: string;
  owner?: string;
  emailStatus?: string;
  status?: string;
  view?: string;
  page?: string;
}

function mapOwner(owner: string | undefined): string | undefined {
  if (!owner) return undefined;
  if (owner === "mine") return "me";
  if (owner === "unassigned") return "unassigned";
  return isUuid(owner) ? owner : undefined;
}

export function buildContactsRedirectQuery(sp: LegacyLeadsQuery): string {
  const params = new URLSearchParams();
  // `/contacts` always needs an explicit `view` to render its tab bar;
  // "all" (no filters) is the closest equivalent to `/leads`'s unscoped list.
  params.set("view", "all");

  const q = [sp.name, sp.company].filter(Boolean).join(" ").trim();
  if (q) params.set("q", q);

  if (sp.industryGroup) params.set("industryGroup", sp.industryGroup);
  if (sp.seniority) params.set("seniority", sp.seniority);

  const owner = mapOwner(sp.owner);
  if (owner) params.set("owner", owner);

  if (isEmailStatusKey(sp.emailStatus)) params.set("emailStatus", sp.emailStatus);
  if (isLeadStatusKey(sp.status)) params.set("status", sp.status);

  if (sp.view === "board") params.set("layout", "board");
  if (sp.page) params.set("page", sp.page);

  return params.toString();
}

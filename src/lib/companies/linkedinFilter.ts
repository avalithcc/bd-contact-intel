import { isNotNull, isNull, type SQL } from "drizzle-orm";
import { company } from "@/db/schema";
import type { LinkedinPresence } from "@/lib/companies/linkedinPresence";

/**
 * `/companies` LinkedIn presence filter — same contract as
 * clientStatusFilter.ts: `undefined` in ("any"), `undefined` out. The column
 * is normalised on write (blank clears to NULL, linkedinUrl.ts), so NULL is
 * the only "missing" state. No index: a null test over ~14.7k rows folded
 * into the existing count and page queries costs no extra round trip.
 */
export function linkedinPresenceCondition(presence: LinkedinPresence | undefined): SQL | undefined {
  if (presence === "with") return isNotNull(company.linkedinUrl);
  if (presence === "without") return isNull(company.linkedinUrl);
  return undefined;
}

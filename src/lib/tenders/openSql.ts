import { sql } from "drizzle-orm";
import { tender, tenderPortal } from "@/db/schema";

/**
 * How long past its CRM opening date a tender with no portal date is still looked at. The CRM date is an Excel snapshot that a
 * circular can push later, so a tender whose imported date just passed may well be open; without a portal date there is nothing
 * else to say it is, and without this window it would drop out of the query before ever being checked. A week covers the
 * longest postponement seen in production (7 days); after that, silence means it really closed and it falls away on its own.
 */
export const PORTAL_GRACE_DAYS = 7;

/**
 * "Still open", the one rule every tender job selects by (portal refresh and pliego download), so they cannot drift apart. Open
 * by EITHER source: the CRM date is ahead, or the portal's is (a circular can move the opening past the imported date, and that
 * tender must stay reachable or the correction can never land). Or: the portal has no DATE and the CRM date is at most
 * PORTAL_GRACE_DAYS old. The test is "no portal DATE", deliberately NOT "no portal row": a row left by a failed or not_found
 * fetch (or made by a pliego attempt) has never been successfully checked, so it has exactly the hole the grace window exists
 * for; retrying it every 12h for at most 7 days is the intended cost. Do not tighten it to "no row", that reopens the gap.
 * Needs `tender` and a LEFT JOINed `tender_portal` in the query.
 */
export const tenderStillOpenSql = sql`(${tender.openingAt} > now() or ${tenderPortal.openingAt} > now() or (${tenderPortal.openingAt} is null and ${tender.openingAt} > now() - make_interval(days => ${PORTAL_GRACE_DAYS}::int)))`;

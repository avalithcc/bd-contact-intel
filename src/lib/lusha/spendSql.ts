// The two SQL fragments that define "a credit spent" and "inside a window" for the Lusha ledger. ONE definition each, shared by the
// caps (revealDb.ts) and by the admin report's per-BD "today" (adminDb.ts), so the report can never disagree with the cap about a day.
// Its own module because revealDb imports adminDb: adminDb importing revealDb back would be a cycle.

import { sql } from "drizzle-orm";

export const CREDITS = sql.raw("coalesce(credits_charged, credits_reserved)");
export const inWindow = (w: { start: Date; end: Date }) => sql`at >= ${w.start.toISOString()}::timestamptz and at < ${w.end.toISOString()}::timestamptz`;

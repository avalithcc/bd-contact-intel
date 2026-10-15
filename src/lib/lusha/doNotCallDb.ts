// Which of a page of Contacts hold a phone that Lusha flagged doNotCall. ONE bounded query for the whole page (never per row),
// and the matching rule is isNumberFlagged, the same function the contact record uses: one source of truth for "is this number
// flagged". The SQL only pre-filters rows that carry some flagged entry; the rule itself is applied in JS.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { lushaReveal } from "@/db/schema";
import { pickListPhoneStored } from "@/lib/phone";
import { isNumberFlagged } from "./parse";

/** A list page is at most this many rows; the cap keeps the IN list bounded whatever a caller passes. */
const MAX_IDS = 500;

export async function flaggedPhonePersonIds(rows: readonly { id: string; phone: string | null; mobilePhone: string | null }[], reader: Pick<typeof db, "select"> = db): Promise<Set<string>> {
  // The number the list actually dials (as stored): a flag on the Contact's OTHER number is not a reason to warn on this one.
  const shown = new Map(rows.flatMap((r) => { const n = pickListPhoneStored(r.phone, r.mobilePhone); return n ? [[r.id, n] as const] : []; }).slice(0, MAX_IDS));
  if (shown.size === 0) return new Set();
  const found = await reader
    .select({ personId: lushaReveal.personId, payload: lushaReveal.payload })
    .from(lushaReveal)
    .where(
      and(
        inArray(lushaReveal.personId, [...shown.keys()]),
        eq(lushaReveal.field, "phones"),
        eq(lushaReveal.state, "settled"),
        eq(lushaReveal.outcome, "revealed"),
        sql`${lushaReveal.payload} @> '{"phones":[{"doNotCall":true}]}'::jsonb`,
      ),
    );
  return new Set(found.filter((f) => isNumberFlagged((f.payload as { phones?: unknown } | null)?.phones, shown.get(f.personId))).map((f) => f.personId));
}

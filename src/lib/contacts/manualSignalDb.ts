/**
 * Thin DB glue for the "Pegar señal" quick action (task 11.6). Imports `db`
 * (side-effecting, requires DATABASE_URL) so — same convention as
 * src/lib/contacts/propertyEditDb.ts — this file is not unit-tested
 * directly; planManualSignal (manualSignal.ts) carries the tested logic.
 *
 * The row keeps the legacy `/api/signals/manual` shape so every existing
 * reader still sees it: `data.body` holds the pasted text, and `lead_id` is
 * set when the person was folded from a lead (the email drafter in
 * src/app/(app)/leads/actions.ts reads signals by lead id and `data.body`).
 * `person_id` is set directly, since the caller already has the person.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { personIdMap, signal, type Signal } from "@/db/schema";
import { planManualSignal } from "@/lib/contacts/manualSignal";

export async function addManualSignal(personId: string, rawText: string, actorBdId: string): Promise<Signal> {
  const plan = planManualSignal(rawText);
  const [leadMapping] = await db
    .select({ legacyId: personIdMap.legacyId })
    .from(personIdMap)
    .where(and(eq(personIdMap.personId, personId), eq(personIdMap.legacyTable, "lead")))
    .limit(1);
  const [row] = await db
    .insert(signal)
    .values({
      personId,
      leadId: leadMapping?.legacyId ?? null,
      source: "manual_paste",
      data: { body: plan.text, pastedAt: new Date().toISOString() },
      actorBdId,
    })
    .returning();
  return row!;
}

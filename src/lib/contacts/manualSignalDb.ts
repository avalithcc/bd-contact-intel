/**
 * Thin DB glue for the "Pegar señal" quick action (task 11.6). Imports `db`
 * (side-effecting, requires DATABASE_URL) so — same convention as
 * src/lib/contacts/propertyEditDb.ts — this file is not unit-tested
 * directly; planManualSignal (manualSignal.ts) carries the tested logic.
 * Writes directly to `signal.personId` (the Unified-Contact subject FK
 * already present on the table) — no `person_id_map` lookup needed, unlike
 * the legacy `/api/signals/manual` route this replaces, since the caller
 * already has the person's id.
 */
import { db } from "@/db";
import { signal, type Signal } from "@/db/schema";
import { planManualSignal } from "@/lib/contacts/manualSignal";

export async function addManualSignal(personId: string, rawText: string, actorBdId: string): Promise<Signal> {
  const plan = planManualSignal(rawText);
  const [row] = await db
    .insert(signal)
    .values({
      personId,
      source: "manual_paste",
      data: { text: plan.text },
      actorBdId,
    })
    .returning();
  return row!;
}

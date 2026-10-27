"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBd } from "@/lib/queries";
import { parseDropInput } from "@/lib/followUp/cycle";
import { dropFollowUp } from "@/lib/followUp/dropQueries";
import { postponeFollowUpItem, skipFollowUpItem } from "@/lib/followUp/queueQueries";

/**
 * "Posponer a mañana" / "Omitir hoy" (mockup README decision 5) — neither
 * logs an activity, so unlike the reused quick actions (note/call/email/
 * task/meeting/discard, which navigate into the contact record's own
 * dialogs) these two are the queue's own server actions.
 */
export async function postponeFollowUpAction(itemId: string) {
  const me = await getCurrentBd();
  await postponeFollowUpItem(itemId, me.id, new Date());
  revalidatePath("/follow-ups");
}

export async function skipFollowUpAction(itemId: string) {
  const me = await getCurrentBd();
  await skipFollowUpItem(itemId, me.id, new Date());
  revalidatePath("/follow-ups");
}

export type DropFollowUpResult = { ok: true } | { ok: false; error: "reason_required" | "detail_required" | "detail_too_long" };

/**
 * "Dar de baja del seguimiento" (follow-up-expiry). Re-validates on the server what the dialog already enforces, then appends
 * the `follow_up_dropped` activity; the pipeline status is untouched. A second click, or an item that was worked or dropped in
 * the meantime, is a quiet no-op (the page refreshes either way).
 */
export async function dropFollowUpAction(itemId: string, reason: string, detail: string): Promise<DropFollowUpResult> {
  const me = await getCurrentBd();
  const input = parseDropInput(reason, detail);
  if (!input.ok) return input;
  await dropFollowUp({ itemId, bdId: me.id, reason: input.reason, detail: input.detail });
  revalidatePath("/follow-ups");
  return { ok: true };
}

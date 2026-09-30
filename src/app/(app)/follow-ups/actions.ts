"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBd } from "@/lib/queries";
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

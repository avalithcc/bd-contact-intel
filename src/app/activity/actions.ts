"use server";

import { revalidatePath } from "next/cache";
import { revalidateContactSurfaces } from "@/lib/contacts/revalidateContactSurfaces";
import { createActivity } from "@/lib/activity/queries";
import { getCurrentBd } from "@/lib/queries";
import type { NewActivity } from "@/db/schema";

export async function createActivityAction(input: {
  type: string;
  leadId?: string;
  companyKey?: string;
  contactId?: string;
  // Unified-Contact subject (design D1); record page's quick actions (9.2).
  personId?: string;
  metadata?: Record<string, unknown>;
}) {
  const me = await getCurrentBd();

  const activity = await createActivity({
    ...input,
    contactOwnerBdId: input.contactId ? me.id : undefined,
    // Who logged this activity (design "Reference writes"; task 4B.5).
    actorBdId: me.id,
  } as NewActivity);

  // Revalidate all affected paths
  if (input.leadId) revalidatePath(`/leads/${input.leadId}`);
  // The raw key is revalidated IN ADDITION to the canonical one the helper resolves: a caller may pass a personId and a
  // `companyKey` of a different company (the company page's quick action), and revalidating a path that does not exist
  // is a no-op, so both is free. It also covers a resolution that returns null or fails.
  if (input.companyKey) revalidatePath(`/companies/${input.companyKey}`);
  if (input.contactId) revalidatePath(`/contact/${input.contactId}`); // legacy contact route, keyed by contact id (not person id)
  // A note/call/discard on a Contact moves last contact and the follow-up queue.
  if (input.personId) await revalidateContactSurfaces(input.personId, "touch");

  return activity;
}

export async function createNoteAction(
  type: "note" | "email_sent" | "hunter_lookup" | "status_change",
  subject: {
    leadId?: string;
    companyKey?: string;
    contactId?: string;
  },
  metadata: Record<string, unknown>,
) {
  return createActivityAction({
    type,
    ...subject,
    metadata,
  });
}

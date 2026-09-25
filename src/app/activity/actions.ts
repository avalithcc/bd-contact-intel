"use server";

import { revalidatePath } from "next/cache";
import { createActivity } from "@/lib/activity/queries";
import { getCurrentBd } from "@/lib/queries";
import type { NewActivity } from "@/db/schema";

export async function createActivityAction(input: {
  type: string;
  leadId?: string;
  companyKey?: string;
  contactId?: string;
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
  if (input.companyKey) revalidatePath(`/companies/${input.companyKey}`);
  if (input.contactId) revalidatePath(`/contact/${input.contactId}`);

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

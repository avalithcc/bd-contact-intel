"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { revalidateLists } from "@/lib/contacts/revalidateLists";
import { createActivity } from "@/lib/activity/queries";
import { getCanonicalCompanyKeyForPerson } from "@/lib/companies/aliasResolutionDb";
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
  if (input.companyKey) revalidatePath(`/companies/${input.companyKey}`);
  if (input.contactId) revalidatePath(`/contact/${input.contactId}`); // legacy contact route, keyed by contact id (not person id)
  if (input.personId) {
    revalidatePath(`/contacts/${input.personId}`);
    // A note/call/discard on a Contact moves last contact and the follow-up queue.
    revalidateLists("touch");
    // The company page's activity timeline unions in every contact's activity
    // (getCompanyTimeline), so a contact activity changes that page too, yet
    // only `personId` is passed here, never `companyKey`. The record page exists
    // only at the canonical key (getCompanyByKey matches it exactly), so the
    // person's key is resolved through company aliases, the same KEY rule as
    // the timeline's companyContactsCondition. One extra round trip.
    //
    // Best-effort on purpose. The activity has already COMMITTED by this point,
    // so a transient failure resolving the key must not fail the action: that
    // would report a successful write as an error and invite a retry that logs
    // the activity twice. A missed revalidation costs one stale company page
    // until the next navigation; a duplicate note cannot be undone.
    try {
      const canonicalKey = await getCanonicalCompanyKeyForPerson(input.personId);
      if (canonicalKey) revalidatePath(`/companies/${canonicalKey}`);
    } catch (err) {
      // A redirect()/notFound() is thrown, not returned, so it must escape this
      // catch untouched (tests/unit/rethrowNavigationErrors.test.ts).
      unstable_rethrow(err);
      // Anything else is intentionally swallowed — see above.
    }
  }

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

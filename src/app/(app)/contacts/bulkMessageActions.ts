"use server";

/**
 * Bulk "Generar mensajes" (mockups/contacts.html `.bulk-bar`) — smallest
 * faithful version per owner decision: reuses the SAME per-person generator
 * `/contacts/[id]` already calls (messageActions.ts
 * generatePersonOutreachMessageAction), looped sequentially (never
 * Promise.all — one AI Gateway call at a time) over the selected ids,
 * capped at MAX_BULK_GENERATE_MESSAGES (src/lib/contacts/bulkMessages.ts;
 * flagged in the checklist as needing owner confirmation on the exact
 * number). `person.id` is the correct id space here (NOT the legacy
 * `contact.id` `/outreach`'s generateOutreachMessage reads) since `/contacts`
 * table rows are unified Contacts — using the wrong generator would return
 * "not found" for any person without a legacy `contact` row.
 *
 * Called directly from a client component (BulkGenerateMessagesButton.tsx)
 * as a plain async function — not wired to `useActionState`/a `<form>` — so
 * it can't live inside BulkActionsBar's single shared `<form>` (nested
 * forms aren't valid HTML, and this needs to return a result array to
 * render, not redirect).
 */
import { getCurrentBd } from "@/lib/queries";
import { sanitizeBulkPersonIds } from "@/lib/contacts/bulkOwner";
import { capBulkGenerateMessageIds } from "@/lib/contacts/bulkMessages";
import { getContactListRowsByIds } from "@/lib/contacts/listQueries";
import { getDictionary } from "@/lib/i18n/server";
import { generatePersonOutreachMessageAction } from "./messageActions";
import type { Locale } from "@/lib/i18n/locales";
import type { GenerateOutreachMessageResult } from "@/app/(app)/outreach/actions";

export interface BulkGenerateMessageResult {
  personId: string;
  name: string;
  result: GenerateOutreachMessageResult;
}

export interface BulkGenerateMessagesResponse {
  results: BulkGenerateMessageResult[];
  wasCapped: boolean;
}

export async function bulkGenerateMessagesAction(
  locale: Locale,
  rawPersonIds: string[],
): Promise<BulkGenerateMessagesResponse> {
  await getCurrentBd();

  const sanitized = sanitizeBulkPersonIds(rawPersonIds);
  const { ids, wasCapped } = capBulkGenerateMessageIds(sanitized);

  const dict = await getDictionary();
  const rows = ids.length ? await getContactListRowsByIds(ids, dict) : [];
  const rowById = new Map(rows.map((row) => [row.id, row]));

  const results: BulkGenerateMessageResult[] = [];
  for (const personId of ids) {
    const row = rowById.get(personId);
    const name = row ? [row.firstName, row.lastName].filter(Boolean).join(" ") || personId : personId;
    // Sequential by design (owner decision) — never Promise.all here.
    const result = await generatePersonOutreachMessageAction(personId, locale, null, new FormData());
    results.push({ personId, name, result });
  }

  return { results, wasCapped };
}

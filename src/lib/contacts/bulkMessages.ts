/**
 * Bulk "Generar mensajes" (mockups/contacts.html `.bulk-bar`). Owner
 * decision (this batch): smallest faithful version — run the existing
 * per-person message generator (messageActions.ts
 * generatePersonOutreachMessageAction) for every selected contact, capped
 * and run sequentially, results shown one per contact with a copy button.
 * The cap value itself is flagged in the checklist as needing owner
 * confirmation — it is NOT a spec'd number, just a reasonable stopgap so a
 * 200-row bulk selection can't fire 200 sequential AI Gateway calls from
 * one request.
 */
export const MAX_BULK_GENERATE_MESSAGES = 25;

export interface CappedBulkIds {
  ids: string[];
  wasCapped: boolean;
}

export function capBulkGenerateMessageIds(ids: string[]): CappedBulkIds {
  const capped = ids.slice(0, MAX_BULK_GENERATE_MESSAGES);
  return { ids: capped, wasCapped: ids.length > capped.length };
}

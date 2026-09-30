/**
 * Guarantees "oldest first" for any conversation message list rendered in
 * `ConversationDialog` (owner decision 2026-09-30: chat convention — the
 * dialog opens scrolled to the newest message, which only makes sense if the
 * list itself is chronological). Both `getOwnConversationMessages` and
 * `getConversationForAdmin`'s LinkedIn rows already `ORDER BY sentAt ASC` in
 * SQL — this is a presentation-layer guarantee that does not trust that
 * ordering blindly, so a future query change (or a caller that merges rows
 * from more than one query) can never silently flip the dialog's reading
 * order. Pure, no DB.
 */
export interface OrderableMessage {
  sentAt: Date;
}

export function sortMessagesChronologically<T extends OrderableMessage>(messages: readonly T[]): T[] {
  return [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
}

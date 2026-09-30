/**
 * Pure "sent vs. received" rule for one LinkedIn message, shared by
 * `getOwnConversationMessages.ts` (no `@/db` import here on purpose — this
 * file must stay importable, and its test runnable, without a live
 * DATABASE_URL, same convention as effectiveActivityTime.ts). In a 1:1
 * thread there are only two parties, so any non-draft message whose sender
 * is the peer was received; every other message (the BD's own, or an
 * unattributed InMail/company sender) was sent — the exact rule
 * `recomputeMessageSignals` (src/lib/queries.ts) already uses for
 * `conversation.received_count`.
 */
export type MessageDirection = "sent" | "received";

export function resolveMessageDirection(
  senderProfileKey: string | null,
  peerProfileKey: string | null,
): MessageDirection {
  return senderProfileKey !== null && senderProfileKey === peerProfileKey ? "received" : "sent";
}

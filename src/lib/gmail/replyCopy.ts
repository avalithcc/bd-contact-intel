/**
 * Client-safe slice of the reply feature. The record page's Timeline is a
 * client component, so what it imports as a VALUE must not pull in
 * rawMessage.ts (node:crypto). Keep this file free of imports.
 */
export type ReplyRefusalReason = "empty_thread" | "no_message_id" | "no_recipient" | "unsafe_header";

/** Which dictionary string explains a refusal; each reason has its own, none borrows another's. */
export function replyUnavailableCopyKey(
  reason: ReplyRefusalReason,
): "timelineReplyUnavailable" | "timelineReplyUnsafeHeader" | "timelineReplyNoRecipient" {
  if (reason === "unsafe_header") return "timelineReplyUnsafeHeader";
  if (reason === "no_message_id") return "timelineReplyUnavailable";
  return "timelineReplyNoRecipient";
}

/**
 * Pure planner for "Responder" on a synced Gmail thread. Derives, from the
 * messages already stored for the thread, everything a real reply needs:
 * recipient, subject, `In-Reply-To`, `References` and the Gmail `threadId`.
 *
 * Why it exists: `Re: <subject>` alone is a reply only in the CRM; in the
 * recipient's mailbox it is a NEW thread unless the message carries the
 * parent's RFC Message-ID. The planner refuses (`no_message_id`) when it
 * cannot do that, instead of sending something that merely looks like a
 * reply. The same function feeds the UI (what to show) and the server action
 * (what to send), so what the BD sees is what goes out — the client never
 * supplies a header.
 *
 * Never mutates its input.
 */
import { assertSafeHeaderValue } from "./rawMessage";

export interface ReplySourceMessage {
  gmailThreadId: string;
  direction: string;
  fromAddress: string;
  // jsonb column: validated element-wise below.
  toAddresses: unknown;
  subject: string | null;
  sentAt: Date;
  rfcMessageId: string | null;
  rfcReferences: string | null;
}

export type ReplyPlan =
  | { ok: true; threadId: string; to: string; subject: string; inReplyTo: string; references: string }
  | { ok: false; reason: "empty_thread" | "no_message_id" | "no_recipient" | "unsafe_header" };

/** RFC 5322 §3.6.4 advises trimming long chains; keep the root and the newest ids. */
export const MAX_REFERENCE_IDS = 20;

const LEADING_RE = /^\s*(?:re\s*:\s*)+/i;

/** One `Re: ` in front of the subject, however many the thread already had. */
export function replySubject(subject: string | null): string {
  const rest = (subject ?? "").replace(LEADING_RE, "").trim();
  return rest ? `Re: ${rest}` : "Re:";
}

function isUnsafe(value: string | null): boolean {
  if (value === null) return false;
  try {
    assertSafeHeaderValue("header", value);
    return false;
  } catch {
    return true;
  }
}

function referenceChain(parentRefs: string | null, parentId: string): string {
  const ids = [...(parentRefs ?? "").split(/\s+/).filter(Boolean)];
  if (ids.at(-1) !== parentId) ids.push(parentId);
  const capped = ids.length > MAX_REFERENCE_IDS ? [ids[0], ...ids.slice(-(MAX_REFERENCE_IDS - 1))] : ids;
  return capped.join(" ");
}

function recipientOf(latest: ReplySourceMessage): string {
  if (latest.direction === "inbound") return latest.fromAddress.trim();
  const list = Array.isArray(latest.toAddresses) ? latest.toAddresses : [];
  return list.filter((a): a is string => typeof a === "string" && a.trim() !== "").join(", ");
}

export function planThreadReply(messages: readonly ReplySourceMessage[]): ReplyPlan {
  if (messages.length === 0) return { ok: false, reason: "empty_thread" };
  // Copy before sorting (the caller's array is not ours to reorder).
  const latest = [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime()).at(-1)!;

  if (isUnsafe(latest.rfcMessageId) || isUnsafe(latest.rfcReferences)) return { ok: false, reason: "unsafe_header" };
  const parentId = latest.rfcMessageId?.trim();
  if (!parentId) return { ok: false, reason: "no_message_id" };
  const to = recipientOf(latest);
  if (!to) return { ok: false, reason: "no_recipient" };

  return {
    ok: true,
    threadId: latest.gmailThreadId,
    to,
    subject: replySubject(latest.subject),
    inReplyTo: parentId,
    references: referenceChain(latest.rfcReferences, parentId),
  };
}

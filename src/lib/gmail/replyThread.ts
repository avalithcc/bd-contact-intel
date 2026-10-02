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
import type { ReplyRefusalReason } from "./replyCopy";

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
  | { ok: false; reason: ReplyRefusalReason };

/** RFC 5322 §3.6.4 advises trimming long chains; keep the root and the newest ids. */
export const MAX_REFERENCE_IDS = 20;

// A run of plain English `re:` is collapsed to one `Re: ` (known-good).
const PLAIN_RE_RUN = /^\s*(?:re\s*:\s*)+/i;

// Reply prefixes of the mail clients this book actually meets: re (English,
// Spanish), r (Italian Outlook), aw / antw (German), sv (Nordic), vs
// (Finnish), rv (Spanish), res (Portuguese), odp (Polish), ynt (Turkish),
// ref. Case-insensitive, optional space before the colon, optional bracketed
// counter some clients add (`Re[2]:`). DELIBERATELY conservative: when the
// subject already starts with one of these it is kept verbatim, so Gmail sees
// exactly the subject the thread already has. An unknown prefix is simply
// treated as part of the subject (we prepend `Re: `); leaving a prefix alone
// is safe, rewriting one we did not fully understand is not.
const KNOWN_REPLY_PREFIX = /^\s*(?:re|r|aw|antw|sv|vs|rv|res|odp|ynt|ref)(?:\[\d+\])?\s*:/i;

/** Subject for a reply: never stacks a prefix, never rewrites one it does not own. */
export function replySubject(subject: string | null): string {
  const text = (subject ?? "").trim();
  if (PLAIN_RE_RUN.test(text)) {
    const rest = text.replace(PLAIN_RE_RUN, "").trim();
    return rest ? `Re: ${rest}` : "Re:";
  }
  if (KNOWN_REPLY_PREFIX.test(text)) return text;
  return text ? `Re: ${text}` : "Re:";
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

/** What the client may see of a plan: never the headers, only what the dialog shows. */
export type ReplyView =
  | { ok: true; to: string; subject: string }
  | { ok: false; reason: Extract<ReplyPlan, { ok: false }>["reason"] };

export function replyView(plan: ReplyPlan): ReplyView {
  return plan.ok ? { ok: true, to: plan.to, subject: plan.subject } : plan;
}

/**
 * A stored Message-ID/References with CR/LF/NUL is not an ordinary gap: it is
 * either corrupt data or a header-injection attempt that got through the
 * sync. Leave a greppable, structured trace (ids only, never the header
 * value) so it can be investigated instead of silently absorbed. A log line,
 * not an audit_log write: this runs on the read path (thread expand) and must
 * not write on every view.
 */
export function logUnsafeReplyHeader(bdId: string, personId: string, gmailThreadId: string): void {
  console.error(`[reply] unsafe_header ${JSON.stringify({ bdId, personId, gmailThreadId })}`);
}

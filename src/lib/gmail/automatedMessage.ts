// Is this message machine-generated rather than a person answering? Pure; reads only what the
// parser already holds. THE one detector: thread attribution (a bounce lands in the thread of the
// mail that bounced and must never become "a reply") and Sequence reply handling
// (applySequenceReplies: an out-of-office must never move a member, memberState.ts `auto_reply`)
// both ask this function, so they cannot disagree about what an auto-reply is.
//
// The signals are the protocol ones first, then two fallbacks for clients that set none:
//  - Auto-Submitted (RFC 3834): anything other than "no" is machine-generated (auto-replied for
//    out-of-office, auto-generated for most notifications, auto-notified).
//  - X-Autoreply / X-Autorespond: vendor markers that assert "this IS an autoresponse", by presence.
//    X-Auto-Response-Suppress is deliberately NOT one: it asks recipients not to auto-reply to THIS message and Exchange
//    stamps it on ordinary mail (see the test that pins this).
//  - Precedence auto_reply / bulk / junk (`list` is a mailing list and says nothing here).
//  - X-Failed-Recipients: set by MTAs on a delivery failure.
//  - multipart/report (RFC 3462): the envelope of a delivery status notification, including
//    the Exchange / Office 365 NDRs whose sender is a mailbox like MicrosoftExchange329e...@tenant.
//  - The sender's address is mailer-daemon@ or postmaster@ (the address, never the display name).
//  - The subject OPENS with an out-of-office / automatic-reply / undeliverable prefix. Only the
//    start counts: "Re: out of office coverage" is a person, and a vacation BODY under a plain
//    "Re:" subject is a person who happens to be away. The body is deliberately never read.
// The asymmetry to keep in mind when adding a signal: a false positive hides a real reply, and a
// Sequence would then send its reminder to someone who already answered.
import { extractEmailAddresses } from "./classify";
import type { GmailApiHeader } from "./parseMessage";

const header = (headers: readonly GmailApiHeader[] | undefined, name: string): string =>
  (headers ?? []).find((h) => h.name.toLowerCase() === name)?.value.trim() ?? "";

const hasHeader = (headers: readonly GmailApiHeader[] | undefined, name: string): boolean =>
  (headers ?? []).some((h) => h.name.toLowerCase() === name);

const MARKER_HEADERS = ["x-autoreply", "x-autorespond"];
const AUTOMATIC_PRECEDENCE = new Set(["auto_reply", "bulk", "junk"]);
const SYSTEM_SENDER_LOCAL_PART = new Set(["mailer-daemon", "postmaster"]);
const AUTOMATIC_SUBJECT_PREFIX =
  /^\s*(out of (the )?office|automatic reply|auto[- ]?reply|autoreply|undeliverable|undelivered mail|delivery status notification|mail delivery (failed|failure))\b|^\s*auto:/i;

/**
 * The subject-prefix rule on its own. Exported so the historical-damage measurement
 * (autoReplyBackfill.ts) judges a stored subject by the very same rule the live detector uses.
 */
export function hasAutomaticSubjectPrefix(subject: string | null | undefined): boolean {
  return AUTOMATIC_SUBJECT_PREFIX.test(subject ?? "");
}

/**
 * The matched prefix alone, lower-cased ("out of office", "automatic reply", "auto:"), or null. It
 * comes from a fixed vocabulary, so it is safe to print: the rest of a subject is arbitrary text that
 * usually echoes the original subject and can carry a person's name.
 */
export function automaticSubjectPrefix(subject: string | null | undefined): string | null {
  const match = AUTOMATIC_SUBJECT_PREFIX.exec(subject ?? "");
  return match ? match[0].trim().toLowerCase().replace(/\s+/g, " ") : null;
}

/**
 * Does the message CLAIM to be a delivery report? Only the three DSN-specific signals of the list above: an
 * X-Failed-Recipients header, a multipart/report envelope, a mailer-daemon@ / postmaster@ sender. A generic auto-reply
 * (Auto-Submitted, Precedence, an "Automatic reply:" subject) must NOT match: an out-of-office is machine-generated and
 * still not a notification, so the sync's "a notification yielded no bounce" log (syncAccount.ts) would be noise.
 * isAutomatedMessage is built from this same function, so the two cannot disagree about what a DSN looks like.
 */
export function looksLikeDeliveryReport(headers: readonly GmailApiHeader[] | undefined, topLevelMimeType: string | undefined): boolean {
  if (header(headers, "x-failed-recipients") !== "") return true;
  const contentType = (topLevelMimeType || header(headers, "content-type")).toLowerCase();
  if (contentType.startsWith("multipart/report")) return true;
  const senderLocalPart = (extractEmailAddresses(header(headers, "from"))[0] ?? "").split("@")[0] ?? "";
  return SYSTEM_SENDER_LOCAL_PART.has(senderLocalPart);
}

export function isAutomatedMessage(headers: readonly GmailApiHeader[] | undefined, topLevelMimeType: string | undefined): boolean {
  const autoSubmitted = header(headers, "auto-submitted").toLowerCase();
  if (autoSubmitted !== "" && autoSubmitted !== "no") return true;
  if (MARKER_HEADERS.some((name) => hasHeader(headers, name))) return true;
  if (AUTOMATIC_PRECEDENCE.has(header(headers, "precedence").toLowerCase())) return true;
  if (looksLikeDeliveryReport(headers, topLevelMimeType)) return true;
  return hasAutomaticSubjectPrefix(header(headers, "subject"));
}

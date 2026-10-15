// Is this message machine-generated rather than a person answering? Pure; reads only what the
// parser already holds. Built for thread attribution (a bounce lands in the thread of the mail
// that bounced and must never become "a reply"), and meant to be reused wherever an automatic
// reply must not move anything (memberState.ts declares an `auto_reply` trigger that nothing
// emits yet).
//
// The signals are the protocol ones, not guesses at sender names:
//  - Auto-Submitted (RFC 3834): anything other than "no" is machine-generated (auto-replied for
//    out-of-office, auto-generated for most notifications, auto-notified).
//  - X-Failed-Recipients: set by MTAs on a delivery failure.
//  - multipart/report (RFC 3462): the envelope of a delivery status notification, including
//    the Exchange / Office 365 NDRs whose sender is a mailbox like MicrosoftExchange329e...@tenant.
// Not covered: a plain-text out-of-office from a client that sets none of these.
import type { GmailApiHeader } from "./parseMessage";

const header = (headers: readonly GmailApiHeader[] | undefined, name: string): string =>
  (headers ?? []).find((h) => h.name.toLowerCase() === name)?.value.trim() ?? "";

export function isAutomatedMessage(headers: readonly GmailApiHeader[] | undefined, topLevelMimeType: string | undefined): boolean {
  const autoSubmitted = header(headers, "auto-submitted").toLowerCase();
  if (autoSubmitted !== "" && autoSubmitted !== "no") return true;
  if (header(headers, "x-failed-recipients") !== "") return true;
  const contentType = (topLevelMimeType || header(headers, "content-type")).toLowerCase();
  return contentType.startsWith("multipart/report");
}

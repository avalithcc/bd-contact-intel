/**
 * Typed error reasons for the Contact record's server actions (fresh-review
 * WARNING fix). Server actions can't reliably forward a thrown `Error`'s raw
 * message to the client — Next.js redacts it in production — and a raw
 * English message must never reach the (Spanish-only) UI anyway. Every
 * action returns a plain `{ ok: false, reason }` instead of throwing across
 * the server/client boundary; `contactActionErrorReason` maps the underlying
 * typed errors to one of these reasons, and
 * `src/lib/contacts/labels.ts#contactActionErrorMessage` maps a reason to
 * the Spanish string to display.
 */
import { ContactMergedError } from "@/lib/contacts/mergeGuard";
import { ContactNotFoundError } from "@/lib/contacts/errors";
import { InvalidEmailError } from "@/lib/contacts/propertyEdit";
import { GmailSendError } from "@/lib/gmail/errors";
import { DiscardNoteRequiredError, DiscardReasonRequiredError } from "@/lib/contacts/discard";
import { MeetingDateRequiredError } from "@/lib/contacts/meeting";
import { ManualSignalTextRequiredError } from "@/lib/contacts/manualSignal";

export type ContactActionErrorReason =
  | "not_found"
  | "merged"
  | "invalid_email"
  | "not_editable"
  | "gmail_not_connected"
  | "gmail_reauth"
  | "gmail_unavailable"
  | "discard_reason_required"
  | "discard_note_required"
  | "meeting_date_required"
  | "signal_text_required"
  | "unexpected";

export type ContactActionResult = { ok: true } | { ok: false; reason: ContactActionErrorReason };

/** A property outside EDITABLE_PERSON_PROPERTIES was requested for edit. */
export class PropertyNotEditableError extends Error {
  constructor(public readonly property: string) {
    super(`Property is not editable from the record page: ${property}`);
    this.name = "PropertyNotEditableError";
  }
}

export function contactActionErrorReason(err: unknown): ContactActionErrorReason {
  if (err instanceof ContactMergedError) return "merged";
  if (err instanceof ContactNotFoundError) return "not_found";
  if (err instanceof InvalidEmailError) return "invalid_email";
  if (err instanceof PropertyNotEditableError) return "not_editable";
  if (err instanceof GmailSendError) {
    if (err.kind === "not_connected") return "gmail_not_connected";
    if (err.kind === "reauth_required") return "gmail_reauth";
    return "gmail_unavailable";
  }
  if (err instanceof DiscardReasonRequiredError) return "discard_reason_required";
  if (err instanceof DiscardNoteRequiredError) return "discard_note_required";
  if (err instanceof MeetingDateRequiredError) return "meeting_date_required";
  if (err instanceof ManualSignalTextRequiredError) return "signal_text_required";
  return "unexpected";
}

/**
 * Path to reconnect Gmail, for reasons where the user can self-serve the
 * fix. `undefined` for reasons that don't have an actionable link.
 */
export function contactActionErrorHref(reason: ContactActionErrorReason): string | undefined {
  if (reason === "gmail_not_connected" || reason === "gmail_reauth") return "/account/email";
  return undefined;
}

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
import { CompanyNotFoundError } from "@/lib/companies/errors";
import {
  InvalidEmailError,
  InvalidPhoneError,
  PropertyBatchEditError,
  type LocationProperty,
} from "@/lib/contacts/propertyEdit";
import { GmailSendError } from "@/lib/gmail/errors";
import { DiscardNoteRequiredError, DiscardReasonRequiredError } from "@/lib/contacts/discard";
import { MeetingDateRequiredError } from "@/lib/contacts/meeting";
import { CallOccurredAtInFutureError, CallOutcomeRequiredError } from "@/lib/contacts/call";
import { ManualSignalTextRequiredError } from "@/lib/contacts/manualSignal";
import { InvalidAssigneeError } from "@/lib/tasks/assignee";

export type ContactActionErrorReason =
  | "not_found"
  | "merged"
  | "invalid_email"
  | "invalid_phone"
  | "not_editable"
  | "gmail_not_connected"
  | "gmail_reauth"
  | "gmail_unavailable"
  | "discard_reason_required"
  | "discard_note_required"
  | "meeting_date_required"
  | "call_outcome_required"
  | "call_occurred_at_in_future"
  | "signal_text_required"
  | "owner_invalid"
  | "owner_locked"
  | "company_not_found"
  | "unexpected";

/** A `?owner=` `<select>` value that isn't blank and isn't a well-formed
 * uuid (src/lib/contacts/bulkOwner.ts#normalizeOwnerSelectValue). */
export class OwnerValueInvalidError extends Error {
  constructor() {
    super("Owner value is not a blank string or a valid uuid");
    this.name = "OwnerValueInvalidError";
  }
}

/** R3 blocked the reassignment: the person already has a
 * `person_bd_connection` row (same rule as updateLeadOwner/bulkAssignOwner —
 * see design.md R3). */
export class OwnerReassignLockedError extends Error {
  constructor() {
    super("Owner cannot be reassigned: person already has a connected BD (R3)");
    this.name = "OwnerReassignLockedError";
  }
}

export type ContactActionResult = { ok: true } | { ok: false; reason: ContactActionErrorReason };

/**
 * Result of the atomic "Ubicación" save (fresh-review CRITICAL fix). Same
 * shape as `ContactActionResult` plus WHICH of the three fields was
 * rejected, since a single `updateContactLocationAction` call now covers
 * city/region/country together and the UI must say which one failed and
 * why — not just that "the save" failed. `property` is `null` for a
 * failure that isn't attributable to one field (e.g. the contact was
 * merged/not found before any field was even planned).
 */
export type ContactLocationActionResult =
  | { ok: true }
  | { ok: false; reason: ContactActionErrorReason; property: LocationProperty | null };

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
  if (err instanceof InvalidPhoneError) return "invalid_phone";
  if (err instanceof PropertyNotEditableError) return "not_editable";
  if (err instanceof GmailSendError) {
    if (err.kind === "not_connected") return "gmail_not_connected";
    if (err.kind === "reauth_required") return "gmail_reauth";
    return "gmail_unavailable";
  }
  if (err instanceof DiscardReasonRequiredError) return "discard_reason_required";
  if (err instanceof DiscardNoteRequiredError) return "discard_note_required";
  if (err instanceof MeetingDateRequiredError) return "meeting_date_required";
  if (err instanceof CallOutcomeRequiredError) return "call_outcome_required";
  if (err instanceof CallOccurredAtInFutureError) return "call_occurred_at_in_future";
  if (err instanceof ManualSignalTextRequiredError) return "signal_text_required";
  if (err instanceof OwnerValueInvalidError) return "owner_invalid";
  // A task's assignee `<select>` reuses the same "owner_invalid" message
  // (l.errorOwnerInvalid) — both mean "pick a real, valid BD".
  if (err instanceof InvalidAssigneeError) return "owner_invalid";
  if (err instanceof OwnerReassignLockedError) return "owner_locked";
  if (err instanceof CompanyNotFoundError) return "company_not_found";
  return "unexpected";
}

/**
 * Unwraps a `PropertyBatchEditError` thrown by `planLocationEdit` into the
 * rejected field plus the SAME reason a single-field edit would report for
 * its `cause` (so "city" rejected for an invalid format maps to
 * `invalid_email`/`invalid_phone` exactly like `updateContactPropertyAction`
 * does today — one mapping table, not two).
 */
const LOCATION_PROPERTIES = new Set<string>(["city", "region", "country"] satisfies LocationProperty[]);

export function contactLocationActionErrorReason(
  err: unknown,
): { reason: ContactActionErrorReason; property: LocationProperty } | null {
  if (!(err instanceof PropertyBatchEditError)) return null;
  // `planLocationEdit` only ever plans city/region/country, so a
  // `PropertyBatchEditError` reaching here can only name one of those three
  // — this check documents (and enforces) that assumption rather than
  // silently casting.
  if (!LOCATION_PROPERTIES.has(err.property)) return null;
  return { reason: contactActionErrorReason(err.cause), property: err.property as LocationProperty };
}

/**
 * Path to reconnect Gmail, for reasons where the user can self-serve the
 * fix. `undefined` for reasons that don't have an actionable link.
 */
export function contactActionErrorHref(reason: ContactActionErrorReason): string | undefined {
  if (reason === "gmail_not_connected" || reason === "gmail_reauth") return "/account/email";
  return undefined;
}

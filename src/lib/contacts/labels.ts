import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ClientStrings } from "@/lib/i18n/clientStrings";
import type { ContactActionErrorReason } from "@/app/(app)/contacts/actionErrors";
import type { StatusReasonEvidence } from "@/lib/status/deriveStatus";

// AboutPane (`/contacts/[id]`) is a client component — same ClientStrings
// convention as src/lib/leads/labels.ts / src/lib/i18n/navLabels.ts.
// `leadStatuses` is reused as-is: `person.status` and `lead.status` share
// the same vocabulary (design D4).
export type ContactRecordLabels = ClientStrings<Dictionary["contactRecord"]> & {
  leadStatuses: Dictionary["leadStatuses"];
};

export function pickContactRecordLabels(dict: Dictionary): ContactRecordLabels {
  return { ...dict.contactRecord, leadStatuses: dict.leadStatuses };
}

/**
 * `/contacts` list's bulk-action bar (task 13.2) is a client component
 * (BulkActionsBar.tsx) — same ClientStrings convention. "Asignar
 * responsable" labels shipped in PR 13b1a; "Crear tarea" labels join in
 * this PR (13b1b). The result-summary formatters (`bulkResultOwner`/
 * `bulkResultTask`) stay server-side (page.tsx renders the result banner
 * from the `?bulkResult=` redirect param).
 */
export type BulkActionsLabels = ClientStrings<
  Pick<
    Dictionary["contactList"],
    | "bulkSelectAllLabel"
    | "bulkSelectedSuffix"
    | "bulkAssignOwner"
    | "bulkCreateTask"
    | "bulkClearSelection"
    | "bulkOwnerLabel"
    | "bulkOwnerUnassign"
    | "bulkConfirm"
    | "bulkCancel"
    | "bulkTaskTitleLabel"
    | "bulkTaskDueLabel"
    | "bulkExport"
    | "bulkGenerateMessages"
    | "bulkMessagesCapNotice"
    | "bulkSelectAllMatching"
    | "bulkSelectAllMatchingNotice"
  >
>;

export function pickBulkActionsLabels(dict: Dictionary): BulkActionsLabels {
  const l = dict.contactList;
  return {
    bulkSelectAllLabel: l.bulkSelectAllLabel,
    bulkSelectedSuffix: l.bulkSelectedSuffix,
    bulkAssignOwner: l.bulkAssignOwner,
    bulkCreateTask: l.bulkCreateTask,
    bulkClearSelection: l.bulkClearSelection,
    bulkOwnerLabel: l.bulkOwnerLabel,
    bulkOwnerUnassign: l.bulkOwnerUnassign,
    bulkConfirm: l.bulkConfirm,
    bulkCancel: l.bulkCancel,
    bulkTaskTitleLabel: l.bulkTaskTitleLabel,
    bulkTaskDueLabel: l.bulkTaskDueLabel,
    bulkExport: l.bulkExport,
    bulkGenerateMessages: l.bulkGenerateMessages,
    bulkMessagesCapNotice: l.bulkMessagesCapNotice,
    bulkSelectAllMatching: l.bulkSelectAllMatching,
    bulkSelectAllMatchingNotice: l.bulkSelectAllMatchingNotice,
  };
}

/**
 * Maps a server action's typed error reason to the Spanish string to show
 * (fresh-review WARNING fix: raw English `Error.message` must never reach
 * the UI). Plain function, not part of the dictionary payload handed to a
 * client component, so it's exempt from the ClientStrings guard.
 */
export function contactActionErrorMessage(l: ContactRecordLabels, reason: ContactActionErrorReason): string {
  switch (reason) {
    case "merged":
      return l.errorMerged;
    case "not_found":
      return l.errorNotFound;
    case "invalid_email":
      return l.errorInvalidEmail;
    case "not_editable":
      return l.errorNotEditable;
    case "gmail_not_connected":
      return l.errorGmailNotConnected;
    case "gmail_reauth":
      return l.errorGmailReauth;
    case "gmail_unavailable":
      return l.errorGmailUnavailable;
    case "discard_reason_required":
      return l.errorDiscardReasonRequired;
    case "discard_note_required":
      return l.errorDiscardNoteRequired;
    case "meeting_date_required":
      return l.errorMeetingDateRequired;
    case "signal_text_required":
      return l.errorSignalTextRequired;
    case "owner_invalid":
      return l.errorOwnerInvalid;
    case "owner_locked":
      return l.errorOwnerLocked;
    case "unexpected":
      return l.genericError;
  }
}

/**
 * Composes the record page's "Estado" derivation "why" hint (mockup-port
 * r02; contact-record.html:77 "Respondió porque ... el 12 oct. Registrar
 * una reunión para pasar a Reunión."). Server-only (imports
 * `dict.contactRecordServer`'s function templates directly, NOT via
 * `ContactRecordLabels` — that type is `ClientStrings`-wrapped and forbids
 * function values; see the comment on `contactRecordServer` in
 * dictionaries/es.ts). Callers pass this function's plain-string RESULT
 * down to the client component, never the templates themselves.
 * `dateLabel`/`nextStepHint`/`emptyValue` are pre-formatted/looked-up by the
 * caller (page.tsx), same as every other date shown on this page.
 */
const ACTIVITY_SOURCE_LABEL_KEY: Partial<Record<string, keyof Dictionary["contactRecordServer"]>> = {
  email_sent: "statusReasonSourceEmail",
  meeting_logged: "statusReasonSourceMeeting",
  status_change: "statusReasonSourceStatusChange",
  status_backfill: "statusReasonSourceStatusChange",
  discarded: "statusReasonSourceDiscard",
  note: "statusReasonSourceNote",
  hunter_lookup: "statusReasonSourceHunter",
};

export function describeStatusReason(
  serverStrings: Dictionary["contactRecordServer"],
  leadStatuses: Dictionary["leadStatuses"],
  emptyValue: string,
  nextStepHint: string,
  evidence: StatusReasonEvidence,
  dateLabel: string,
): string {
  const statusLabel = leadStatuses[evidence.status as keyof typeof leadStatuses] ?? evidence.status;

  let sourceDescription: string;
  if (evidence.because.source === "connection") {
    const bdName = evidence.bdName ?? emptyValue;
    sourceDescription =
      evidence.status === "replied"
        ? serverStrings.statusReasonSourceConnectionReplied(bdName)
        : serverStrings.statusReasonSourceConnectionSent(bdName);
  } else {
    const key = evidence.activityType ? ACTIVITY_SOURCE_LABEL_KEY[evidence.activityType] : undefined;
    sourceDescription = key
      ? (serverStrings[key] as string)
      : serverStrings.statusReasonSourceStatusChange;
  }

  const sentence = serverStrings.statusReasonSentence(statusLabel, sourceDescription, dateLabel);
  return evidence.status === "replied" ? `${sentence} ${nextStepHint}` : sentence;
}

/**
 * `/contacts/import` (task 14.2): the LinkedIn-connections upload form and
 * the dedup-outcome summary are both client components — same ClientStrings
 * convention as the rest of this file.
 */
export type ContactsImportLabels = ClientStrings<Dictionary["contactsImport"]>;

export function pickContactsImportLabels(dict: Dictionary): ContactsImportLabels {
  return { ...dict.contactsImport };
}

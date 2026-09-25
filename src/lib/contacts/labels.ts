import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ClientStrings } from "@/lib/i18n/clientStrings";
import type { ContactActionErrorReason } from "@/app/(app)/contacts/actionErrors";

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
    case "unexpected":
      return l.genericError;
  }
}

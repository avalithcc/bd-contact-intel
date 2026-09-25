import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ClientStrings } from "@/lib/i18n/clientStrings";

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

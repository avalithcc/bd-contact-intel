import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ClientStrings } from "@/lib/i18n/clientStrings";

// Only plain strings (and flat records of strings) may cross the
// server -> client boundary — the full dictionary contains nested records
// and functions that don't all serialize cleanly as props, so each client
// component gets its own narrow subset. ClientStrings<> makes adding a
// formatter function to one of these slices a compile error. Same
// convention as src/lib/outreach/messageLabels.ts.

export type LeadsUploadLabels = ClientStrings<
  Pick<
    Dictionary["leads"],
    | "sourceKeyLabel"
    | "sourceKeyPlaceholder"
    | "sourceNameLabel"
    | "sourceNamePlaceholder"
    | "attendeesFileLabel"
    | "decisoresFileLabel"
    | "hunterFileLabel"
    | "probablesFileLabel"
    | "correosFinalFileLabel"
    | "columnaCorreosFileLabel"
    | "import"
    | "importing"
    | "importedSummary"
    | "matchedOwnersSummary"
    | "unmatchedOwnersSummary"
    | "importErrors"
  >
>;

export function pickLeadsUploadLabels(dict: Dictionary): LeadsUploadLabels {
  const l = dict.leads;
  return {
    sourceKeyLabel: l.sourceKeyLabel,
    sourceKeyPlaceholder: l.sourceKeyPlaceholder,
    sourceNameLabel: l.sourceNameLabel,
    sourceNamePlaceholder: l.sourceNamePlaceholder,
    attendeesFileLabel: l.attendeesFileLabel,
    decisoresFileLabel: l.decisoresFileLabel,
    hunterFileLabel: l.hunterFileLabel,
    probablesFileLabel: l.probablesFileLabel,
    correosFinalFileLabel: l.correosFinalFileLabel,
    columnaCorreosFileLabel: l.columnaCorreosFileLabel,
    import: l.import,
    importing: l.importing,
    importedSummary: l.importedSummary,
    matchedOwnersSummary: l.matchedOwnersSummary,
    unmatchedOwnersSummary: l.unmatchedOwnersSummary,
    importErrors: l.importErrors,
  };
}

export type LeadEditLabels = ClientStrings<
  Pick<
    Dictionary["leads"],
    | "fieldStatus"
    | "fieldNotes"
    | "fieldNotesPlaceholder"
    | "fieldOwner"
    | "ownerUnassigned"
    | "saveChanges"
    | "savingChanges"
    | "savedChanges"
    | "saveError"
  > & {
    leadStatuses: Dictionary["leadStatuses"];
  }
>;

export function pickLeadEditLabels(dict: Dictionary): LeadEditLabels {
  const l = dict.leads;
  return {
    fieldStatus: l.fieldStatus,
    fieldNotes: l.fieldNotes,
    fieldNotesPlaceholder: l.fieldNotesPlaceholder,
    fieldOwner: l.fieldOwner,
    ownerUnassigned: l.ownerUnassigned,
    saveChanges: l.saveChanges,
    savingChanges: l.savingChanges,
    savedChanges: l.savedChanges,
    saveError: l.saveError,
    leadStatuses: dict.leadStatuses,
  };
}

import type { ContactRecordLabels } from "@/lib/contacts/labels";

// Plain module on purpose: the server layout calls pickCallFormLabels, and a function exported from a "use client" file is only a client reference on the server.
/** The strings CallForm needs. Narrow on purpose: the app shell mounts the dialog, so it must not carry the whole record dictionary. */
export type CallFormLabels = Pick<
  ContactRecordLabels,
  | "callSubmit"
  | "cancel"
  | "callOutcomeLabel"
  | "callOutcomePlaceholder"
  | "callOutcomeConnected"
  | "callOutcomeBusy"
  | "callOutcomeNoAnswer"
  | "callOutcomeVoicemail"
  | "callOutcomeWrongNumber"
  | "callDateLabel"
  | "callTimeLabel"
  | "callNotesLabel"
  | "callHelp"
  | "errorCallOccurredAtInFuture"
>;

export function pickCallFormLabels(l: CallFormLabels): CallFormLabels {
  return {
    callSubmit: l.callSubmit,
    cancel: l.cancel,
    callOutcomeLabel: l.callOutcomeLabel,
    callOutcomePlaceholder: l.callOutcomePlaceholder,
    callOutcomeConnected: l.callOutcomeConnected,
    callOutcomeBusy: l.callOutcomeBusy,
    callOutcomeNoAnswer: l.callOutcomeNoAnswer,
    callOutcomeVoicemail: l.callOutcomeVoicemail,
    callOutcomeWrongNumber: l.callOutcomeWrongNumber,
    callDateLabel: l.callDateLabel,
    callTimeLabel: l.callTimeLabel,
    callNotesLabel: l.callNotesLabel,
    callHelp: l.callHelp,
    errorCallOccurredAtInFuture: l.errorCallOccurredAtInFuture,
  };
}

import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ClientStrings } from "@/lib/i18n/clientStrings";

// Only plain strings may cross the server→client boundary: the full
// dictionary contains formatter functions, which React cannot serialize.
// ClientStrings<> makes that a compile error instead of a runtime crash.
export type GenerateMessageLabels = ClientStrings<
  Pick<
    Dictionary["outreach"],
    | "generateMessage"
    | "generatingMessage"
    | "regenerateMessage"
    | "copyMessage"
    | "copiedMessage"
    | "generateMessageErrors"
    | "generateMessageHistoryHintOne"
    | "generateMessageHistoryHintMany"
    | "chooseMessageLanguage"
    | "messageLanguageEs"
    | "messageLanguageEn"
    | "messageLanguagePt"
    | "cancelChooseLanguage"
    | "generateMessageChannelLabel"
    | "generateMessageChannelEmail"
    | "generateMessageChannelLinkedin"
    | "generateMessageLanguageLabel"
    | "generateMessageSignalsLabel"
    | "generateMessageSignalHiringOne"
    | "generateMessageSignalHiringMany"
    | "generateMessageSignalLeadership"
    | "generateMessageSignalRepliedBefore"
    | "generateMessageSignalNotesPresentOne"
    | "generateMessageSignalNotesPresentMany"
    | "generateMessageSignalLastContact"
    | "generateMessageDraftLabel"
    | "generateMessageDraftHelp"
    | "generateMessageGenerateAction"
  >
>;

export function pickGenerateMessageLabels(dict: Dictionary): GenerateMessageLabels {
  const o = dict.outreach;
  return {
    generateMessage: o.generateMessage,
    generatingMessage: o.generatingMessage,
    regenerateMessage: o.regenerateMessage,
    copyMessage: o.copyMessage,
    copiedMessage: o.copiedMessage,
    generateMessageErrors: o.generateMessageErrors,
    generateMessageHistoryHintOne: o.generateMessageHistoryHintOne,
    generateMessageHistoryHintMany: o.generateMessageHistoryHintMany,
    chooseMessageLanguage: o.chooseMessageLanguage,
    messageLanguageEs: o.messageLanguageEs,
    messageLanguageEn: o.messageLanguageEn,
    messageLanguagePt: o.messageLanguagePt,
    cancelChooseLanguage: o.cancelChooseLanguage,
    generateMessageChannelLabel: o.generateMessageChannelLabel,
    generateMessageChannelEmail: o.generateMessageChannelEmail,
    generateMessageChannelLinkedin: o.generateMessageChannelLinkedin,
    generateMessageLanguageLabel: o.generateMessageLanguageLabel,
    generateMessageSignalsLabel: o.generateMessageSignalsLabel,
    generateMessageSignalHiringOne: o.generateMessageSignalHiringOne,
    generateMessageSignalHiringMany: o.generateMessageSignalHiringMany,
    generateMessageSignalLeadership: o.generateMessageSignalLeadership,
    generateMessageSignalRepliedBefore: o.generateMessageSignalRepliedBefore,
    generateMessageSignalNotesPresentOne: o.generateMessageSignalNotesPresentOne,
    generateMessageSignalNotesPresentMany: o.generateMessageSignalNotesPresentMany,
    generateMessageSignalLastContact: o.generateMessageSignalLastContact,
    generateMessageDraftLabel: o.generateMessageDraftLabel,
    generateMessageDraftHelp: o.generateMessageDraftHelp,
    generateMessageGenerateAction: o.generateMessageGenerateAction,
  };
}

/** Builds an OutreachSignalLabels bag (messageSignalLabels.ts) from the
 * plain-string, {n}/{date}-templated dictionary fields above — kept out of
 * the pure lib module since it's UI-copy formatting, not signal logic. */
export function signalLabelsFromDict(labels: GenerateMessageLabels) {
  return {
    hiring: (count: number) =>
      (count === 1 ? labels.generateMessageSignalHiringOne : labels.generateMessageSignalHiringMany).replace(
        "{n}",
        String(count),
      ),
    leadership: labels.generateMessageSignalLeadership,
    repliedBefore: labels.generateMessageSignalRepliedBefore,
    notesPresent: (count: number) =>
      (count === 1
        ? labels.generateMessageSignalNotesPresentOne
        : labels.generateMessageSignalNotesPresentMany
      ).replace("{n}", String(count)),
    lastContact: (date: string) => labels.generateMessageSignalLastContact.replace("{date}", date),
  };
}

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
    | "cancelChooseLanguage"
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
    cancelChooseLanguage: o.cancelChooseLanguage,
  };
}

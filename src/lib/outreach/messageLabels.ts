import type { Dictionary } from "@/lib/i18n/dictionaries";

// Only plain strings may cross the server→client boundary: the full
// dictionary contains formatter functions, which React cannot serialize.
export type GenerateMessageLabels = Pick<
  Dictionary["outreach"],
  | "generateMessage"
  | "generatingMessage"
  | "regenerateMessage"
  | "copyMessage"
  | "copiedMessage"
  | "generateMessageErrors"
  | "generateMessageHistoryHintOne"
  | "generateMessageHistoryHintMany"
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
  };
}

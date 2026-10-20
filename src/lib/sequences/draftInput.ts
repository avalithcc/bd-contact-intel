/**
 * The ONE place the language of a Sequence draft is decided, and the only function the drafting code may use to build
 * generator input. The live generator (runGenerateOutreachMessage) writes Spanish unless told "en"
 * (DEFAULT_MESSAGE_LANGUAGE is "es"), so the language is never a caller choice: it is the `language` field of the
 * recipient's compliance audience (complianceAudience.ts). Address and language are two fields of ONE resolution, not one
 * value read twice, so neither can be inferred from the other: a Mexican contact is Spanish AND under the Miami address.
 * An audience of null (no location signal, or an embargoed jurisdiction) yields no input at all: the member is held.
 *
 * tests/unit/sequencesDraftLanguageGuard.test.ts fails the build if any other file under src/lib/sequences or the
 * sequence actions reaches the generator or the prompt builders. Pure: no DB. The prompt (buildOutreachMessagePrompt)
 * is reused untouched, so its anti-hallucination and prompt-injection rules apply to Sequence drafts as everywhere.
 */
import type { ComplianceAudience } from "@/lib/sequences/complianceAudience";
import type { MessageLanguage } from "@/lib/outreach/messageLanguage";
import type { BuildOutreachMessagePromptInput, OutreachPurpose } from "@/lib/outreach/messagePrompt";
import { extractOutreachSignals, type OutreachSignal } from "@/lib/outreach/messageSignals";
import { buildPersonMessageInput, type BuildPersonMessageInputArgs } from "@/lib/outreach/personMessageInput";

export type SequenceDraftInputArgs = Omit<BuildPersonMessageInputArgs, "language" | "channel">;

/**
 * Null when the contact has no audience: the caller must hold the member instead of generating. `purpose` picks
 * the first email or the step 2 reminder; it never touches the language, which only the audience decides.
 */
export function buildSequenceDraftInput(
  args: SequenceDraftInputArgs,
  audience: ComplianceAudience | null,
  purpose: OutreachPurpose = "first",
): BuildOutreachMessagePromptInput | null {
  if (!audience) return null;
  const { language } = audience;
  // Spread first so a stray `language`/`channel` on the args can never win.
  return { ...buildPersonMessageInput({ ...args, language, channel: "email" }), purpose };
}

/** The "Señales usadas" chips, derived from the SAME input the generator gets and never from model output. */
export function draftSignals(input: BuildOutreachMessagePromptInput): OutreachSignal[] {
  return extractOutreachSignals(input);
}

/** Sign-off identity, in the draft's own language. Only the owner has a title on file. */
export function senderIdentity(
  name: string,
  language: MessageLanguage,
): { senderName: string; senderTitle: string | undefined } {
  const senderName = name.trim() || "Cristian Civita";
  if (senderName !== "Cristian Civita") return { senderName, senderTitle: undefined };
  return { senderName, senderTitle: language === "es" ? "COO de Avalith" : "COO at Avalith" };
}

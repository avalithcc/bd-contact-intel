/**
 * The ONE place the language of a Sequence draft is decided, and the only function the drafting code may use to build
 * generator input. The live generator (runGenerateOutreachMessage) writes Spanish unless told "en"
 * (DEFAULT_MESSAGE_LANGUAGE is "es"), so the language may never be an incidental caller argument: it is the `language`
 * field of the recipient's compliance audience (complianceAudience.ts), UNLESS a person explicitly chose another one for
 * this contact. That choice is a recorded fact about the member (sequence_member.draft_language, with who and when), read
 * by the drafting code and handed in through the distinct, typed `chosenLanguage` parameter; it is never smuggled inside
 * `args` (SequenceDraftInputArgs still omits `language`), so a forgotten or forged value cannot draft a US contact in Spanish.
 * Address and language are two fields of ONE resolution, not one value read twice, so neither can be inferred from the
 * other: a Mexican contact is Spanish AND under the Miami address. A choice changes the language and NOTHING ELSE: the
 * address always comes from the audience, because it is the CAN-SPAM address of the entity nearest the recipient and is
 * not editorial (resolveDraftCompliance). An audience of null (no location signal, or an embargoed jurisdiction) yields no
 * input at all whatever was chosen: the member is held, and a language cannot unblock a missing address.
 *
 * tests/unit/sequencesDraftLanguageGuard.test.ts fails the build if any other file under src/lib/sequences or the
 * sequence actions reaches the generator or the prompt builders. Pure: no DB. The prompt (buildOutreachMessagePrompt)
 * is reused untouched, so its anti-hallucination and prompt-injection rules apply to Sequence drafts as everywhere.
 */
import type { AudienceLanguage, ComplianceAddress, ComplianceAudience } from "@/lib/sequences/complianceAudience";
import type { MessageLanguage } from "@/lib/outreach/messageLanguage";
import type { BuildOutreachMessagePromptInput, OutreachPurpose } from "@/lib/outreach/messagePrompt";
import { extractOutreachSignals, type OutreachSignal } from "@/lib/outreach/messageSignals";
import { buildPersonMessageInput, type BuildPersonMessageInputArgs } from "@/lib/outreach/personMessageInput";

export type SequenceDraftInputArgs = Omit<BuildPersonMessageInputArgs, "language" | "channel">;

/**
 * The address and language a draft is composed with. The address is ALWAYS the audience's; the language is the recorded
 * human choice when there is one, the audience's otherwise. Null when the contact has no audience (a HOLD).
 */
export function resolveDraftCompliance(
  audience: ComplianceAudience | null,
  chosenLanguage?: AudienceLanguage | null,
): { address: ComplianceAddress; language: AudienceLanguage } | null {
  if (!audience) return null;
  return { address: audience.address, language: chosenLanguage ?? audience.language };
}

/**
 * Null when the contact has no audience: the caller must hold the member instead of generating. `purpose` picks
 * the first email or the step 2 reminder; it never touches the language. `chosenLanguage` is the human choice stored on
 * the member (null when nobody chose), never a per-call preference.
 */
export function buildSequenceDraftInput(
  args: SequenceDraftInputArgs,
  audience: ComplianceAudience | null,
  purpose: OutreachPurpose = "first",
  chosenLanguage?: AudienceLanguage | null,
): BuildOutreachMessagePromptInput | null {
  const compliance = resolveDraftCompliance(audience, chosenLanguage);
  if (!compliance) return null;
  const { language } = compliance;
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

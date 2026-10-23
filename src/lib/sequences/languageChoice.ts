/**
 * The recorded human choice of a Sequence draft's language (sequence_member.draft_language / _by_bd_id / _at). Pure, no I/O.
 * NULL means "nobody chose": the audience's language applies, which is exactly the behaviour before this existed. Only
 * `es` and `en` exist (AudienceLanguage): a Brazilian contact gets English by owner decision, so there is no Portuguese
 * to choose. What the choice does with the language is decided in draftInput.ts, the one place that decides it.
 */
import type { AudienceLanguage } from "./complianceAudience";

export const LANGUAGE_CHOICES: readonly AudienceLanguage[] = ["es", "en"];

/** The trust boundary for the action AND for a stored value: exactly `es` or `en`, otherwise null (reads as "no choice"). */
export function parseLanguageChoice(value: unknown): AudienceLanguage | null {
  return LANGUAGE_CHOICES.find((l) => l === value) ?? null;
}

export type ChoiceStep = { action: "none" } | { action: "set"; language: AudienceLanguage } | { action: "clear" };

/**
 * What confirming the dialog writes. Confirming the language the system already resolves records nothing (that is not a
 * human override, and a later country correction should still be able to move it); picking the resolved language while an
 * override is stored clears the override.
 */
export function choiceToStore(resolved: AudienceLanguage, stored: AudienceLanguage | null, selected: AudienceLanguage): ChoiceStep {
  if (selected === resolved) return stored === null ? { action: "none" } : { action: "clear" };
  return selected === stored ? { action: "none" } : { action: "set", language: selected };
}

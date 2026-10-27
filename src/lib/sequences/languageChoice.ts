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

/** The two human statements about a draft's language. `chosen` is the one-off of one member, `preferred` is person.preferred_language. */
export interface DraftLanguageOverrides {
  readonly chosen?: unknown;
  readonly preferred?: unknown;
}

export type DraftLanguageSource = "chosen" | "preferred" | "audience";

export interface ResolvedDraftLanguage {
  /** What the draft is written in. */
  readonly language: AudienceLanguage;
  readonly source: DraftLanguageSource;
  /** What it would be without the one-off choice: the preference if there is one, else the audience's. The dialog and "Volver al idioma resuelto" measure against it. */
  readonly baseline: AudienceLanguage;
  readonly baselineSource: "preferred" | "audience";
}

/**
 * The ONE place the language of an outreach draft is decided: a one-off choice on the member beats the contact's preferred
 * language, which beats the audience chain. The draft input, the unsubscribe page and every screen call this, so they cannot
 * disagree. It decides the LANGUAGE only: the address is the audience's and a contact without an audience is held by the caller
 * (a null `audienceLanguage` with no override resolves to null). Both overrides are raw stored values and are parsed here, so
 * anything that is not exactly es/en reads as "nobody said".
 */
export function resolveDraftLanguage(audienceLanguage: AudienceLanguage | null, overrides: DraftLanguageOverrides = {}): ResolvedDraftLanguage | null {
  const chosen = parseLanguageChoice(overrides.chosen);
  const preferred = parseLanguageChoice(overrides.preferred);
  const baseline = preferred ?? audienceLanguage;
  if (!baseline) return chosen ? { language: chosen, source: "chosen", baseline: chosen, baselineSource: "audience" } : null;
  const baselineSource = preferred ? "preferred" : "audience";
  return chosen ? { language: chosen, source: "chosen", baseline, baselineSource } : { language: baseline, source: baselineSource, baseline, baselineSource };
}

/**
 * The "Guardar como idioma preferido" checkbox of the language dialog. `baseline` is the language without a one-off choice
 * (ResolvedDraftLanguage.baseline), so it already equals the stored preference when there is one. Null (hidden) when the selection
 * equals it: there is nothing to save. Checked by default only when nothing is stored; unchecked when saving would replace a value.
 */
export function preferredCheckbox(preferred: AudienceLanguage | null, baseline: AudienceLanguage, selected: AudienceLanguage): { checked: boolean; replaces: boolean } | null {
  return selected === baseline ? null : { checked: preferred === null, replaces: preferred !== null };
}

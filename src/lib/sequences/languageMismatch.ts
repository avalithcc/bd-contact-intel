/**
 * "This draft is written in another language than the one we would write in today" as ONE pure predicate. The card, the review
 * dialog, single and bulk approval and the release re-check (preSendChecks, through complianceRefusal) all ask it, so they cannot
 * disagree. Pure and client-safe: only types are imported from the heavy modules.
 *
 * The draft side is `sequence_draft.language`, written at generation from the language the draft was composed with. NULL means
 * "unknown" (every draft stored before the column existed): it is never flagged, because nothing exact says what it was written in
 * (scripts/measure/draft-language-mismatch.ts: the opt-out sentence is the English one on Spanish bodies stored before it was
 * translated). The side of today is NEVER recomputed here: callers pass what resolveDraftLanguage / memberLanguage answered.
 */
import type { AudienceLanguage } from "./complianceAudience";
import { parseLanguageChoice, resolveDraftLanguage, type DraftLanguageOverrides } from "./languageChoice";

export type LanguageMismatch = { readonly draft: AudienceLanguage; readonly now: AudienceLanguage };

/** Null when they match, or when either side is unknown: never mark what cannot be proved. */
export function languageMismatch(draftLanguage: unknown, today: AudienceLanguage | null): LanguageMismatch | null {
  const draft = parseLanguageChoice(draftLanguage);
  return draft && today && draft !== today ? { draft, now: today } : null;
}

/**
 * The language "today" is measured against. Step 1 answers with what the resolver says now. The step 2 reminder is pinned to the
 * language step 1 was written in, so a thread never mixes languages; when that is unknown nothing is pinned and nothing is flagged.
 */
export function languageToday(step: 1 | 2, resolved: AudienceLanguage | null, step1Language: unknown): AudienceLanguage | null {
  return step === 1 ? resolved : parseLanguageChoice(step1Language);
}

/** What the server sides ask (approval, release): the resolver's answer for this member, then pinned for a reminder. The audience language is the NOW one. */
export const languageNow = (step: 1 | 2, audienceLanguage: AudienceLanguage | null, overrides: DraftLanguageOverrides, step1Language: unknown): AudienceLanguage | null =>
  languageToday(step, resolveDraftLanguage(audienceLanguage, overrides)?.language ?? null, step1Language);

/** The overrides a reminder is drafted with: step 1's language rides in the resolver's strongest slot (the one-off), so the draft follows it. Returns a new object. */
export function pinToStep1(overrides: DraftLanguageOverrides, step1Language: unknown): DraftLanguageOverrides {
  const pinned = parseLanguageChoice(step1Language);
  return pinned ? { ...overrides, chosen: pinned } : { ...overrides };
}

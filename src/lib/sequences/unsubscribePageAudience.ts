import { localeForMessageLanguage } from "@/lib/outreach/messageLanguage";
import type { Locale } from "@/lib/i18n/locales";
import { COMPLIANCE_CONFIG } from "./config";
import { resolveComplianceAudience, type ComplianceAudienceInputs } from "./complianceAudience";
import { resolveDraftLanguage, type DraftLanguageOverrides } from "./languageChoice";

/**
 * What the unsubscribe page needs to know about the recipient: the postal address their email carried and the language
 * it was written in. Independent of each other (a Mexican contact is Miami + Spanish), so both are carried.
 */
export interface UnsubscribePageAudience {
  readonly postalAddress?: string;
  readonly locale: Locale;
}

/**
 * The page audience of a contact: the address and the default language from the same signals the draft used, and the
 * recorded human statements about the language when there are any: the member's one-off choice (sequence_member.draft_language)
 * and the contact's preferred language (person.preferred_language). The page's locale is decided by resolveDraftLanguage, the
 * same function the draft uses, so the page cannot disagree with the draft; the address always comes from the audience.
 *
 * `overrides` hold the raw stored values. Anything that is not exactly es/en (NULL, or a garbage text value) reads as
 * "nobody said" and the audience's language applies.
 *
 * With no audience there is no address (never another country's), but a chosen language is still honoured; with neither
 * the result is undefined and the page falls back to English.
 */
export function unsubscribePageAudience(input: ComplianceAudienceInputs, overrides: DraftLanguageOverrides = {}): UnsubscribePageAudience | undefined {
  const audience = resolveComplianceAudience(input);
  const resolved = resolveDraftLanguage(audience?.language ?? null, overrides);
  if (!audience) return resolved ? { locale: localeForMessageLanguage(resolved.language) } : undefined;
  return { postalAddress: COMPLIANCE_CONFIG[audience.address]?.postalAddress, locale: localeForMessageLanguage(resolved!.language) };
}

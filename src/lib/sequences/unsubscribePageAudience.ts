import { localeForMessageLanguage } from "@/lib/outreach/messageLanguage";
import type { Locale } from "@/lib/i18n/locales";
import { COMPLIANCE_CONFIG } from "./config";
import { resolveComplianceAudience, type ComplianceAudienceInputs } from "./complianceAudience";
import { parseLanguageChoice } from "./languageChoice";

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
 * recorded human language choice (sequence_member.draft_language) when there is one. This is the ONE place the page's
 * locale is decided, mirroring resolveDraftCompliance for the draft: the choice wins for the language and touches nothing
 * else, the address always comes from the audience.
 *
 * `chosenLanguage` is the raw stored value. Anything that is not exactly es/en (NULL, or a garbage text value) reads as
 * "nobody chose" and the audience's language applies, the same way draftQueries and detailQueries treat the column, so
 * the page cannot disagree with the draft about what counts as a choice.
 *
 * With no audience there is no address (never another country's), but a chosen language is still honoured; with neither
 * the result is undefined and the page falls back to English.
 */
export function unsubscribePageAudience(input: ComplianceAudienceInputs, chosenLanguage?: unknown): UnsubscribePageAudience | undefined {
  const audience = resolveComplianceAudience(input);
  const chosen = parseLanguageChoice(chosenLanguage);
  if (!audience) return chosen ? { locale: localeForMessageLanguage(chosen) } : undefined;
  return { postalAddress: COMPLIANCE_CONFIG[audience.address]?.postalAddress, locale: localeForMessageLanguage(chosen ?? audience.language) };
}

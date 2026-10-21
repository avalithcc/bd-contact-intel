import { localeForMessageLanguage } from "@/lib/outreach/messageLanguage";
import type { Locale } from "@/lib/i18n/locales";
import { COMPLIANCE_CONFIG } from "./config";
import { resolveComplianceAudience, type ComplianceAudienceInputs } from "./complianceAudience";

/**
 * What the unsubscribe page needs to know about the recipient: the postal address their email carried and the language
 * it was written in. Independent of each other (a Mexican contact is Miami + Spanish), so both are carried.
 */
export interface UnsubscribePageAudience {
  readonly postalAddress?: string;
  readonly locale: Locale;
}

/** The page audience of a contact, from the same signals the draft used. Undefined when the contact has no audience. */
export function unsubscribePageAudience(input: ComplianceAudienceInputs): UnsubscribePageAudience | undefined {
  const audience = resolveComplianceAudience(input);
  if (!audience) return undefined;
  return { postalAddress: COMPLIANCE_CONFIG[audience.address]?.postalAddress, locale: localeForMessageLanguage(audience.language) };
}

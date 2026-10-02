/**
 * `/companies` list filter "has / does not have a LinkedIn page" — the URL
 * vocabulary and its validator, same shape as clientStatus.ts. The absent
 * value is the third state ("any"): an unknown param is dropped, never
 * guessed. The condition lives in linkedinFilter.ts.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries";

export const LINKEDIN_PRESENCES = ["with", "without"] as const;
export type LinkedinPresence = (typeof LINKEDIN_PRESENCES)[number];

export function isLinkedinPresence(value: string | undefined): value is LinkedinPresence {
  return !!value && (LINKEDIN_PRESENCES as readonly string[]).includes(value);
}

export type LinkedinPresenceLabels = Pick<Dictionary["companyList"], "filterLinkedinWith" | "filterLinkedinWithout">;

export function linkedinPresenceLabel(value: LinkedinPresence, l: LinkedinPresenceLabels): string {
  return value === "with" ? l.filterLinkedinWith : l.filterLinkedinWithout;
}

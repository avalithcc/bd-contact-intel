/**
 * Every URL the worker opens or fetches is built here from the configured CRM origin plus validated parts.
 * The worker never follows a URL it was handed (not from a message, not from a server answer).
 */
import type { ProfileBasics } from "../shared/messages";

/** Same names as PREFILL_PARAM_KEYS in src/lib/contacts/linkedinProfilePrefill.ts (a unit test pins the pair). */
export const PREFILL_PARAMS: Record<keyof ProfileBasics, string> = {
  name: "li_name",
  title: "li_title",
  company: "li_company",
  location: "li_location",
};

/** Same ceiling as PREFILL_MAX_LENGTH on the CRM side, which re-caps anyway. */
const MAX_PARAM_LENGTH = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lookupEndpoint(origin: string, profileUrl: string): string {
  return `${origin}/api/extension/linkedin-lookup?url=${encodeURIComponent(profileUrl)}`;
}

/** "Nuevo contacto" prefilled. Unreadable (empty) fields are left out of the URL. */
export function buildAddUrl(origin: string, profileUrl: string, basics: ProfileBasics): string {
  const url = new URL("/contacts", origin);
  url.searchParams.set("new", "1");
  url.searchParams.set("linkedin", profileUrl);
  for (const key of Object.keys(PREFILL_PARAMS) as (keyof ProfileBasics)[]) {
    const value = basics[key].trim().slice(0, MAX_PARAM_LENGTH);
    if (value) url.searchParams.set(PREFILL_PARAMS[key], value);
  }
  return url.toString();
}

export function buildViewUrl(origin: string, personId: string): string | null {
  return UUID.test(personId) ? `${origin}/contacts/${personId}` : null;
}

export function buildLoginUrl(origin: string): string {
  return `${origin}/login`;
}

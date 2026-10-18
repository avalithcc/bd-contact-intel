/**
 * What the LinkedIn extension may put into "Nuevo contacto" through the query string
 * (`/contacts?new=1&linkedin=…&li_name=…&li_title=…&li_company=…&li_location=…`). The query string is
 * untrusted input: every value is capped, stripped of control characters and whitespace-collapsed, and the
 * full name goes through the CRM's own stuffed-name rules (src/lib/identity/stuffedNameFirstTokenSplit.ts)
 * instead of a rule of its own. Anything unreadable stays an empty string. Pure, no I/O.
 */
import { deriveFirstTokenSplit, stripLinkedInScrapeArtifact } from "@/lib/identity/stuffedNameFirstTokenSplit";

export const PREFILL_MAX_LENGTH = 200;

/** Query params the extension adds next to `linkedin`; the dialog removes them on close. */
export const PREFILL_PARAM_KEYS = ["li_name", "li_title", "li_company", "li_location"] as const;

export interface ProfilePrefill {
  firstName: string;
  lastName: string;
  jobTitle: string;
  company: string;
  location: string;
}

export interface ProfilePrefillParams {
  name?: string;
  title?: string;
  company?: string;
  location?: string;
}

function clean(value: string | undefined): string {
  if (!value) return "";
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PREFILL_MAX_LENGTH)
    .trim();
}

function splitName(raw: string): { firstName: string; lastName: string } {
  const name = stripLinkedInScrapeArtifact(raw) ?? raw;
  const split = deriveFirstTokenSplit({ firstName: name });
  if (split.kind === "fill") return { firstName: split.fill.firstName, lastName: split.fill.lastName };
  // Single token or a bare initial: the rule refuses to invent a surname, so the BD completes it.
  const commaIndex = name.indexOf(",");
  return { firstName: clean(commaIndex >= 0 ? name.slice(0, commaIndex) : name), lastName: "" };
}

/** `undefined` when the extension sent nothing usable, so the dialog shows no "Desde LinkedIn" chrome. */
export function parseProfilePrefill(params: ProfilePrefillParams): ProfilePrefill | undefined {
  const name = clean(params.name);
  const prefill: ProfilePrefill = {
    ...(name ? splitName(name) : { firstName: "", lastName: "" }),
    jobTitle: clean(params.title),
    company: clean(params.company),
    location: clean(params.location),
  };
  const hasAny = Object.values(prefill).some((value) => value !== "");
  return hasAny ? prefill : undefined;
}

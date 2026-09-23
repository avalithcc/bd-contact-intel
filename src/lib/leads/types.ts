/**
 * Small enums shared by the leads import, queries, and UI.
 *
 * Display labels are localized — see src/lib/i18n/dictionaries/{en,es}.ts
 * (`leadEmailStatuses` / `leadStatuses` records), keyed by the same key so
 * the key list lives in exactly one place, same convention as
 * src/lib/roleGroups.ts.
 */

export type EmailStatusKey = "verified" | "probable" | "none";

export const EMAIL_STATUSES: EmailStatusKey[] = ["verified", "probable", "none"];

export function isEmailStatusKey(v: string | undefined): v is EmailStatusKey {
  return !!v && (EMAIL_STATUSES as string[]).includes(v);
}

export type LeadStatusKey =
  | "new"
  | "contacted"
  | "replied"
  | "meeting"
  | "discarded";

export const LEAD_STATUSES: LeadStatusKey[] = [
  "new",
  "contacted",
  "replied",
  "meeting",
  "discarded",
];

export function isLeadStatusKey(v: string | undefined): v is LeadStatusKey {
  return !!v && (LEAD_STATUSES as string[]).includes(v);
}

// Rank used to decide whether a newly discovered email status should
// replace an existing one — see src/lib/leads/csv.ts. Higher wins.
export const EMAIL_STATUS_RANK: Record<EmailStatusKey, number> = {
  none: 0,
  probable: 1,
  verified: 2,
};

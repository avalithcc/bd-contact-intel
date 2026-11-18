/** Our own state for a tender, from "worth a look" to a decision. Validated here, not by a CHECK constraint. */
export const TENDER_TRIAGE_STATES = ["a_revisar", "en_analisis", "vamos", "descartada"] as const;
export type TenderTriage = (typeof TENDER_TRIAGE_STATES)[number];

export function isTenderTriage(value: unknown): value is TenderTriage {
  return typeof value === "string" && (TENDER_TRIAGE_STATES as readonly string[]).includes(value);
}

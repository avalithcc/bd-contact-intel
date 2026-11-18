/**
 * The ONE definition of "is this tender for us". Pure and client-safe (no `@/db` import): the list's SQL filter in
 * queries.ts mirrors it and a db test holds the two together.
 *
 * Precedence: a human's call (`relevanceOverride`) beats the model's verdict (`aiRelevant`); with neither, the tender is
 * "unclassified", and an unclassified tender is SHOWN. Hiding a tender because a model call failed is the worst outcome here.
 */
export interface RelevanceColumns {
  aiRelevant: boolean | null;
  aiReason: string | null;
  relevanceOverride: boolean | null;
}

export type RelevanceState = "relevant" | "irrelevant" | "unclassified";

export interface TenderRelevance {
  state: RelevanceState;
  source: "human" | "ai" | "none";
  /** The model's six-word reason, kept even when a human overrode the verdict so the screen can show what was overruled. */
  reason: string | null;
}

export function tenderRelevance(t: RelevanceColumns): TenderRelevance {
  if (t.relevanceOverride !== null) return { state: t.relevanceOverride ? "relevant" : "irrelevant", source: "human", reason: t.aiReason };
  if (t.aiRelevant !== null) return { state: t.aiRelevant ? "relevant" : "irrelevant", source: "ai", reason: t.aiReason };
  return { state: "unclassified", source: "none", reason: null };
}

/** What a BD can say about one tender. "auto" takes the human's call back and lets the model's verdict decide again. */
export const TENDER_RELEVANCE_CHOICES = ["auto", "relevant", "irrelevant"] as const;
export type TenderRelevanceChoice = (typeof TENDER_RELEVANCE_CHOICES)[number];

export function isRelevanceChoice(value: unknown): value is TenderRelevanceChoice {
  return typeof value === "string" && (TENDER_RELEVANCE_CHOICES as readonly string[]).includes(value);
}

export const overrideFromChoice = (choice: TenderRelevanceChoice): boolean | null => (choice === "auto" ? null : choice === "relevant");

export const choiceFromOverride = (override: boolean | null): TenderRelevanceChoice => (override === null ? "auto" : override ? "relevant" : "irrelevant");

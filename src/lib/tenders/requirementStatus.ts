/**
 * What Avalith has for each requirement of the must-list, as the administrative area answers. THREE states, not a checkbox:
 * an unchecked box would mean both "nobody asked yet" (pending work) and "they said we do not have it" (a reason not to bid).
 * Conflating an absent value with a negative one is a recurring defect here, so the absent value is its own state.
 * 'pending' is never stored: a missing row IS pending. Pure and client-safe.
 */
import { MUST_LIST_ROWS } from "./mustList";

export const REQUIREMENT_STATUSES = ["pending", "have", "missing"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

/** The eight stable keys of the must-list. The status is keyed by these, NEVER by the requirement's text (model output, rewritten on every re-analysis). */
export const REQUIREMENT_KEYS = MUST_LIST_ROWS.map(([key]) => key);
export type RequirementKey = (typeof MUST_LIST_ROWS)[number][0];

/** Only the decisions: a key that is not here is pending. */
export type RequirementStatuses = Partial<Record<RequirementKey, Exclude<RequirementStatus, "pending">>>;

export const isRequirementStatus = (v: unknown): v is RequirementStatus => typeof v === "string" && (REQUIREMENT_STATUSES as readonly string[]).includes(v);
export const isRequirementKey = (v: unknown): v is RequirementKey => typeof v === "string" && (REQUIREMENT_KEYS as readonly string[]).includes(v);

export const statusOf = (statuses: RequirementStatuses, key: RequirementKey): RequirementStatus => statuses[key] ?? "pending";

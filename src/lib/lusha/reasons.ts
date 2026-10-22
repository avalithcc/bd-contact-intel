// The single table from a Lusha failure to the reason the BD sees (D14). It lives here, not in
// actionErrors.ts, because nothing under src/app may import this library before PR 6 (lushaInert.test.ts);
// actionErrors.ts repeats the literals in ContactActionErrorReason and a unit test pins that they agree.

import type { LushaErrorKind } from "./errors";

export const LUSHA_REASONS = [
  "lusha_off",
  "lusha_unconfigured",
  "lusha_plan_denied",
  "lusha_no_credits",
  "lusha_rate_limited",
  "lusha_protected",
  "lusha_unavailable",
  "lusha_no_match",
  "lusha_enrich_failed",
  "lusha_async",
  "lusha_unreadable",
  "lusha_outcome_unknown",
  "lusha_cap_reached",
  "lusha_monthly_cap_reached",
  "lusha_personal_cap_reached",
  "lusha_busy",
  "lusha_not_eligible",
  "lusha_insufficient_data",
  "lusha_stale",
  "lusha_not_enabled",
] as const;

export type LushaReason = (typeof LUSHA_REASONS)[number];

// Exhaustive on purpose: a new LushaErrorKind fails the typecheck until it has a reason and copy.
const BY_KIND: Record<LushaErrorKind, LushaReason> = {
  bad_key: "lusha_unconfigured", // a 401 is a deployment problem, not the BD's
  no_credits: "lusha_no_credits", // the ACCOUNT is empty, unlike the daily cap
  plan_denied: "lusha_plan_denied",
  rate_limited: "lusha_rate_limited",
  compliance_blocked: "lusha_protected",
  unavailable: "lusha_unavailable",
  not_found: "lusha_no_match",
  compliance_restricted: "lusha_protected",
  enrich_failed: "lusha_enrich_failed",
  async_unsupported: "lusha_async",
  unparsable_value: "lusha_unreadable",
  cap_exceeded: "lusha_cap_reached",
  busy: "lusha_busy",
  outcome_unknown: "lusha_outcome_unknown",
};

export const reasonForKind = (kind: LushaErrorKind): LushaReason => BY_KIND[kind];

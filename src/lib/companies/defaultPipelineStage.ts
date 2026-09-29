/**
 * Pure classifier for the one-time default `company.relationship_stage`
 * backfill (owner-approved 2026-09-29 — see
 * openspec/decisions/2026-09-30-decision-brief.md, "2. Default pipeline
 * stage — decided"). Only ever applied to companies whose
 * `relationship_stage` is currently NULL: the caller
 * (scripts/backfill-default-pipeline-stage.ts) enforces that guard both
 * when reading candidates and again in the write's `WHERE` clause. This
 * module never sees, and never needs to see, an already-set stage.
 *
 * Precedence, in order:
 *   1. `account_type = 'client'`  -> won
 *   2. `account_type = 'partner'` -> qualified
 *   3. >=1 non-merged contact (`person.company_key` = this company) with
 *      status 'replied' or 'meeting' AND an effective last touch within the
 *      last 12 months -> qualified. "Effective last touch" is the greatest
 *      of the activity-derived time and `person_bd_connection.last_message_at`
 *      — computed ENTIRELY in SQL by
 *      src/lib/companies/defaultPipelineStageDb.ts, reusing
 *      src/lib/contacts/effectiveActivityTime.ts#effectiveActivityAtSql (the
 *      one shared helper — this module never re-implements that rule, it
 *      only receives the already-computed `hasRecentQualifyingContact`
 *      boolean).
 *   4. otherwise -> prospect
 *
 * `account_type = 'strategic_org'` and a null `account_type` both fall
 * through to step 3/4 exactly like any other company — no special case.
 */

export type DefaultPipelineStage = "won" | "qualified" | "prospect";

export interface CompanyDefaultStageInput {
  companyKey: string;
  accountType: string | null;
  /** >=1 non-merged contact at this company with status 'replied' or
   * 'meeting' whose effective last touch is within the last 12 months.
   * Computed in SQL — see
   * defaultPipelineStageDb.ts#readCompanyDefaultStageCandidates. A stale
   * reply (outside the window) and "no qualifying contact at all" both
   * arrive here as `false` — by design, per the owner decision that a
   * years-old reply should not qualify a company forever. */
  hasRecentQualifyingContact: boolean;
}

export function classifyDefaultPipelineStage(input: CompanyDefaultStageInput): DefaultPipelineStage {
  if (input.accountType === "client") return "won";
  if (input.accountType === "partner") return "qualified";
  if (input.hasRecentQualifyingContact) return "qualified";
  return "prospect";
}

export interface DefaultPipelineStagePlan {
  /** Every input company's key, grouped by its resulting stage, in the
   * input's original relative order within each group. */
  byStage: Record<DefaultPipelineStage, string[]>;
}

const EMPTY_BY_STAGE: Record<DefaultPipelineStage, readonly string[]> = {
  won: [],
  qualified: [],
  prospect: [],
};

/**
 * Pure planner: never mutates `candidates` (only iterates it), and always
 * builds a brand-new result object — calling this twice with the same
 * input array returns two structurally-equal plans, and the input itself
 * is left exactly as it was (see
 * tests/unit/defaultPipelineStage.test.ts's "pure planner" test, which
 * freezes the input to prove it).
 */
export function planDefaultPipelineStages(
  candidates: readonly CompanyDefaultStageInput[],
): DefaultPipelineStagePlan {
  const byStage: Record<DefaultPipelineStage, string[]> = {
    won: [...EMPTY_BY_STAGE.won],
    qualified: [...EMPTY_BY_STAGE.qualified],
    prospect: [...EMPTY_BY_STAGE.prospect],
  };
  for (const candidate of candidates) {
    const stage = classifyDefaultPipelineStage(candidate);
    byStage[stage].push(candidate.companyKey);
  }
  return { byStage };
}

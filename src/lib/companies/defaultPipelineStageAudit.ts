/**
 * Pure audit_log metadata builder for
 * scripts/backfill-default-pipeline-stage.ts's `--execute` path, mirroring
 * src/lib/accounts/accountTypeBackfillAudit.ts's shape: one `audit_log` row
 * per run, exact counts per stage plus the actual company_key list so a
 * revert never has to guess.
 *
 * Deliberately NOT capped at the small `AUDIT_LOG_ID_CAP` (100) that
 * src/lib/contacts/bulkOwnerAudit.ts uses — that cap exists because bulk
 * owner reassignment is a routine, potentially-frequent interactive action.
 * This script is a one-time backfill bounded by the total company count
 * (14,255 at decision time, all null `relationship_stage` — see
 * openspec/decisions/2026-09-30-decision-brief.md), so
 * `DEFAULT_PIPELINE_STAGE_AUDIT_KEY_CAP` is set comfortably above that
 * bound: in practice the list is never truncated, and the full
 * `wonCompanyKeys`/`qualifiedCompanyKeys`/`prospectCompanyKeys` triple is
 * exactly what a revert needs:
 *
 *   update company set relationship_stage = null
 *     where relationship_stage = 'won' and company_key in (<wonCompanyKeys>);
 *   update company set relationship_stage = null
 *     where relationship_stage = 'qualified' and company_key in (<qualifiedCompanyKeys>);
 *   update company set relationship_stage = null
 *     where relationship_stage = 'prospect' and company_key in (<prospectCompanyKeys>);
 *
 * (the `relationship_stage = '<bucket>'` re-check means a BD who has since
 * hand-edited one of these companies' stage is never silently reverted).
 */
import type { DefaultPipelineStage } from "@/lib/companies/defaultPipelineStage";

// 20,000 comfortably exceeds the entire `company` table (14,255 rows at
// decision time) — this backfill can never actually hit the cap; it exists
// only so this module has the same defensive shape as every other audit
// builder here, and stays correct if the company table grows.
export const DEFAULT_PIPELINE_STAGE_AUDIT_KEY_CAP = 20000;

function capped(keys: readonly string[]): { keys: string[]; truncated: boolean } {
  const truncated = keys.length > DEFAULT_PIPELINE_STAGE_AUDIT_KEY_CAP;
  return { keys: truncated ? keys.slice(0, DEFAULT_PIPELINE_STAGE_AUDIT_KEY_CAP) : [...keys], truncated };
}

export type AppliedByStage = Record<DefaultPipelineStage, readonly string[]>;

export interface DefaultPipelineStageAuditMetadata {
  wonCount: number;
  wonCompanyKeys: string[];
  wonCompanyKeysTruncated: boolean;
  qualifiedCount: number;
  qualifiedCompanyKeys: string[];
  qualifiedCompanyKeysTruncated: boolean;
  prospectCount: number;
  prospectCompanyKeys: string[];
  prospectCompanyKeysTruncated: boolean;
}

export function buildDefaultPipelineStageAuditMetadata(input: {
  appliedByStage: AppliedByStage;
}): DefaultPipelineStageAuditMetadata {
  const won = capped(input.appliedByStage.won);
  const qualified = capped(input.appliedByStage.qualified);
  const prospect = capped(input.appliedByStage.prospect);
  return {
    wonCount: input.appliedByStage.won.length,
    wonCompanyKeys: won.keys,
    wonCompanyKeysTruncated: won.truncated,
    qualifiedCount: input.appliedByStage.qualified.length,
    qualifiedCompanyKeys: qualified.keys,
    qualifiedCompanyKeysTruncated: qualified.truncated,
    prospectCount: input.appliedByStage.prospect.length,
    prospectCompanyKeys: prospect.keys,
    prospectCompanyKeysTruncated: prospect.truncated,
  };
}

/** A no-op re-run (e.g. `--execute` run again after the real backfill
 * already applied to everything) must NOT write an empty audit_log row —
 * same rule as isNameFromEmailBackfillAuditWorthRecording /
 * isStuffedNameSplitAuditWorthRecording, for the same reason: an empty row
 * would become the newest audit_log row for this action and hide the real
 * backfill from anyone reading history. */
export function isDefaultPipelineStageAuditWorthRecording(input: { appliedByStage: AppliedByStage }): boolean {
  return (
    input.appliedByStage.won.length > 0 ||
    input.appliedByStage.qualified.length > 0 ||
    input.appliedByStage.prospect.length > 0
  );
}

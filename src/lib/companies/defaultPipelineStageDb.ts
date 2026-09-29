/**
 * Thin DB glue for scripts/backfill-default-pipeline-stage.ts. Imports `db`
 * (side-effecting, requires DATABASE_URL), so this file is not unit-tested
 * directly — classifyDefaultPipelineStage/planDefaultPipelineStages
 * (defaultPipelineStage.ts) carry the tested classification logic, and
 * buildDefaultPipelineStageCandidatesQuery (defaultPipelineStageQuery.ts,
 * schema-only import, no `@/db`) carries the tested, rendered-SQL-safe
 * query construction. This module only executes that query and maps the
 * raw rows.
 */
import { db } from "@/db";
import { buildDefaultPipelineStageCandidatesQuery } from "@/lib/companies/defaultPipelineStageQuery";

export interface CompanyDefaultStageCandidateRow {
  companyKey: string;
  accountType: string | null;
  hasRecentQualifyingContact: boolean;
}

/** Every `company` row whose `relationship_stage` is currently NULL — the
 * write path re-checks this same condition at write time (rule: re-check
 * before writing), so a row that a BD sets between this read and the write
 * is never overwritten. */
export async function readCompanyDefaultStageCandidates(): Promise<CompanyDefaultStageCandidateRow[]> {
  const rows = (await db.execute(buildDefaultPipelineStageCandidatesQuery())) as unknown as {
    company_key: string;
    account_type: string | null;
    has_recent_qualifying_contact: boolean;
  }[];

  return rows.map((row) => ({
    companyKey: row.company_key,
    accountType: row.account_type,
    hasRecentQualifyingContact: row.has_recent_qualifying_contact,
  }));
}

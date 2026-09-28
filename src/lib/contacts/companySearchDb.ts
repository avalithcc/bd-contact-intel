/**
 * DB side of the "Cambiar empresa" dialog's company picker. A separate,
 * company-only query rather than reusing the "Nueva tarea" dialog's
 * person+company subject search (src/lib/tasks/subjectSearchDb.ts) — that
 * one also scans `person`, which this dialog never needs. Reuses that
 * file's row mapper (`companySubjectSearchResult`) unchanged, since it
 * already does exactly "company row -> { type, id, label }".
 */
import { ilike } from "drizzle-orm";
import { db } from "@/db";
import { company } from "@/db/schema";
import { companySubjectSearchResult, type TaskSubjectSearchResult } from "@/lib/tasks/subjectSearch";

const LIKE_WILDCARD_RE = /[%_\\]/g;
function escapeLikeWildcards(value: string): string {
  return value.replace(LIKE_WILDCARD_RE, (ch) => `\\${ch}`);
}

const COMPANY_RESULT_LIMIT = 8;

/**
 * Searches companies by display name, bounded to a short results list (no
 * pagination — the dialog only ever shows a handful of matches). A `query`
 * shorter than 2 characters returns no results rather than scanning every
 * company on each keystroke.
 */
export async function searchContactCompanies(query: string): Promise<TaskSubjectSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const pattern = `%${escapeLikeWildcards(trimmed)}%`;

  const rows = await db
    .select({ companyKey: company.companyKey, displayName: company.displayName })
    .from(company)
    .where(ilike(company.displayName, pattern))
    .limit(COMPANY_RESULT_LIMIT);

  return rows.map(companySubjectSearchResult);
}

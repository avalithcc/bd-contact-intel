/**
 * DB side of the "Nueva tarea" dialog's subject picker (mockup-port t04).
 * Split from subjectSearch.ts's pure row mappers so those stay unit-testable
 * without a live DATABASE_URL (same convention as bulkOwner.ts/bulkOwnerDb.ts).
 */
import { and, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { company, person } from "@/db/schema";
import { companySubjectSearchResult, personSubjectSearchResult, type TaskSubjectSearchResult } from "./subjectSearch";

const LIKE_WILDCARD_RE = /[%_\\]/g;
function escapeLikeWildcards(value: string): string {
  return value.replace(LIKE_WILDCARD_RE, (ch) => `\\${ch}`);
}

const PERSON_RESULT_LIMIT = 8;
const COMPANY_RESULT_LIMIT = 5;

/**
 * Searches contacts by name (first, last, or "first last") and companies by
 * display name, each bounded to a small `limit` — the dialog only ever
 * shows a short results list, never a full table, so there is no
 * pagination to build. A `query` shorter than 2 characters returns no
 * results rather than scanning ~26k persons on every keystroke.
 */
export async function searchTaskSubjects(query: string): Promise<TaskSubjectSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const pattern = `%${escapeLikeWildcards(trimmed)}%`;

  const [personRows, companyRows] = await Promise.all([
    db
      .select({ id: person.id, firstName: person.firstName, lastName: person.lastName, company: person.company })
      .from(person)
      .where(
        and(
          sql`${person.mergedIntoId} is null`,
          or(
            ilike(person.firstName, pattern),
            ilike(person.lastName, pattern),
            ilike(sql`${person.firstName} || ' ' || ${person.lastName}`, pattern),
          ),
        ),
      )
      .limit(PERSON_RESULT_LIMIT),
    db
      .select({ companyKey: company.companyKey, displayName: company.displayName })
      .from(company)
      .where(ilike(company.displayName, pattern))
      .limit(COMPANY_RESULT_LIMIT),
  ]);

  return [...personRows.map(personSubjectSearchResult), ...companyRows.map(companySubjectSearchResult)];
}

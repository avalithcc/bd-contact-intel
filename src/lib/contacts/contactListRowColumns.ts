/**
 * The `person`/`bd` column shape every `/contacts` list read (table page,
 * board columns, bulk-export-by-ids) selects — split out of listQueries.ts
 * so `projectContactListRowColumns` stays unit-testable without pulling in
 * `@/db` (that module opens a live `postgres()` connection at import time,
 * which needs `DATABASE_URL`). This file only imports `@/db/schema`
 * (table/column definitions, no connection).
 */
import { bd, person } from "@/db/schema";

export const CONTACT_LIST_ROW_COLUMNS = {
  id: person.id,
  firstName: person.firstName,
  lastName: person.lastName,
  jobTitle: person.jobTitle,
  company: person.company,
  companyKey: person.companyKey,
  ownerBdId: person.ownerBdId,
  ownerName: bd.name,
  status: person.status,
  email: person.email,
  emailStatus: person.emailStatus,
  roleGroup: person.roleGroup,
  industry: person.industry,
  country: person.country,
  sourceKey: person.sourceKey,
  createdAt: person.createdAt,
  seniority: person.seniority,
  phone: person.phone,
  mobilePhone: person.mobilePhone,
} as const;

export const CONTACT_LIST_ROW_KEYS = Object.keys(
  CONTACT_LIST_ROW_COLUMNS,
) as (keyof typeof CONTACT_LIST_ROW_COLUMNS)[];

/**
 * One key builder for `CONTACT_LIST_ROW_COLUMNS` projections: re-selecting
 * the same row shape off a CTE/subquery (see
 * `listQueries.ts#getContactBoardColumns`'s ranked-rows CTE) needs to
 * reference the subquery's own exposed columns, not `person.*` directly —
 * this derives that projection from `CONTACT_LIST_ROW_KEYS` so the two
 * select shapes can never drift apart. Pure: never mutates `source`, and
 * drops any key on `source` that isn't part of the row shape (e.g. a CTE's
 * own window-function alias).
 */
export function projectContactListRowColumns<
  T extends Record<keyof typeof CONTACT_LIST_ROW_COLUMNS, unknown>,
>(source: T): typeof CONTACT_LIST_ROW_COLUMNS {
  return Object.fromEntries(
    CONTACT_LIST_ROW_KEYS.map((key) => [key, source[key]]),
  ) as typeof CONTACT_LIST_ROW_COLUMNS;
}

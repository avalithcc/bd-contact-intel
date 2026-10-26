/**
 * Seguimientos never lists a contact whose company is an ACTIVE client
 * (owner decision, 2026-10-26: "en seguimientos NO quiero ver estado de
 * cliente Activo"). Former clients (`client_status = 'inactive'`) stay: a
 * win-back is legitimate follow-up work. Null (not a client) stays too.
 *
 * DELIBERATELY different from the sequence roster: `rosterGuards.ts` blocks
 * ANY `clientStatus` (active and inactive). Seguimientos excludes only
 * `active`. The difference is the owner's decision of 2026-10-26; do not
 * "fix" either side to match the other. It is also NOT the stricter report
 * definition (`relationship_stage = 'won' and client_status = 'active'`,
 * src/lib/reports/currentClient.ts): the owner asked for client status
 * active, nothing more.
 *
 * Written ONCE and spliced into every place that decides who is in the
 * queue: the insert-side eligibility CTE (candidateQuery.ts) and the three
 * readers of the materialized snapshot (the /follow-ups page read, the
 * sidebar badge count). The snapshot is written once a day, so the insert
 * filter alone would keep today's already-written rows visible; the read
 * filter makes the change immediate and also hides a company marked active
 * mid-day. `src/lib/reports/queries.ts` is intentionally NOT filtered: it
 * counts work already done and must not rewrite past numbers.
 *
 * `personCompanyKey` is the SQL fragment holding the person's company key
 * (e.g. `sql\`person.company_key\``). The subquery is a correlated EXISTS on
 * `company.company_key`, unaliased like every other table in these queries.
 */
import { sql, type SQL } from "drizzle-orm";
import { company } from "@/db/schema";

/** The only client status that hides a contact from Seguimientos. */
export const FOLLOW_UP_EXCLUDED_CLIENT_STATUS = "active";

export function notActiveClientCompanySql(personCompanyKey: SQL): SQL {
  return sql`not exists (
    select 1 from ${company}
    where company.company_key = ${personCompanyKey}
      and company.client_status = ${FOLLOW_UP_EXCLUDED_CLIENT_STATUS}
  )`;
}

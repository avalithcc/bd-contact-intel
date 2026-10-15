/**
 * "Empresa" matching in SQL for both the Contacts ad-hoc filter and global search box and the Sequence roster search.
 *
 * The list DISPLAYS `resolveCompanyDisplayName(person.company, company.display_name)` — the free-text name when it is
 * set, otherwise the canonical name reached through `company_key`. Matching only `person.company` made every contact
 * whose free text is null invisible to a search for the very name its own row shows (owner report: "Empresa: nubiral"
 * returned 0 rows inside "Pasar a correo" while 5 rows in that view displayed "Nubiral"; 6,448 contacts are in that
 * shape).
 *
 * This mirrors the display rule exactly rather than OR-ing both columns: a row matches a company term if and only if
 * the name a BD can actually see matches it. A contact whose free text disagrees with its canonical company keeps
 * matching its free text only, so the filter never returns a row whose "Empresa" cell shows an unrelated name.
 *
 * The rule with all its cases lives in `companyDisplayName.ts#companyNameMatchesTerm`, a pure unit-tested function this
 * SQL is the translation of — change one and the other is wrong.
 *
 * EXISTS against the `company` primary key, never a join — callers feed several separate reads (table, board, total
 * count, per-view counts) and none of them can be assumed to join `company`.
 *
 * DB-free on purpose (no `@/db`): the Sequence roster query is rendered by unit tests with no database. `cols` names the
 * person columns as the CALLER spells them: the default is the drizzle `person` table, a raw `from person p` read passes
 * `p.company` / `p.company_key` (an aliased table cannot be referenced as "person").
 */
import { sql, type SQL } from "drizzle-orm";
import { company, person } from "@/db/schema";

export interface PersonCompanyColumns {
  company: SQL;
  companyKey: SQL;
}

const PERSON_COLUMNS: PersonCompanyColumns = { company: sql`${person.company}`, companyKey: sql`${person.companyKey}` };

export function companyNameMatchCondition(pattern: string, cols: PersonCompanyColumns = PERSON_COLUMNS): SQL {
  return sql`(${cols.company} ilike ${pattern} or ((${cols.company} is null or ${cols.company} = '') and exists (select 1 from ${company} where ${company.companyKey} = ${cols.companyKey} and ${company.displayName} ilike ${pattern})))`;
}

/**
 * DB side of "Para": loading live contacts (merged-away ones resolved to their survivor) with their company key
 * canonicalised through company_alias, then handing them to the pure rules in para.ts. The picker's candidate list reads
 * the same company definition the company record uses (aliases count, merged-away people do not).
 *
 * Round trips: `resolveParaRecipients` is ONE statement for the usual case (no merged-away id); each merge hop adds one.
 */
import { and, asc, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { bd, companyAlias, person } from "@/db/schema";
import { aliasKeyIsNotLiveCompany } from "@/lib/companies/aliasRule";
import { INTERNAL_CC_DOMAIN } from "./cc";
import { evaluatePara, type ParaPerson, type ParaResult } from "./para";

const MAX_MERGE_HOPS = 5;

async function readPeople(ids: string[]) {
  return db
    .select({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      emailNormalized: person.emailNormalized,
      companyKey: person.companyKey,
      mergedIntoId: person.mergedIntoId,
      aliasTarget: companyAlias.companyKey,
    })
    .from(person)
    .leftJoin(companyAlias, and(sql`${companyAlias.aliasKey} = ${person.companyKey}`, aliasKeyIsNotLiveCompany()))
    .where(inArray(person.id, ids));
}

/** Requested id -> the live contact it stands for (after following merges), or undefined when it does not resolve. */
export async function loadParaPeople(requested: readonly string[]): Promise<Map<string, ParaPerson | undefined>> {
  const result = new Map<string, ParaPerson | undefined>();
  let pending = new Map<string, string>(requested.map((id) => [id, id])); // requested id -> id currently being resolved
  for (let hop = 0; pending.size > 0 && hop <= MAX_MERGE_HOPS; hop++) {
    const rows = new Map((await readPeople([...new Set(pending.values())])).map((r) => [r.id, r]));
    const next = new Map<string, string>();
    for (const [asked, current] of pending) {
      const row = rows.get(current);
      if (!row) result.set(asked, undefined);
      else if (row.mergedIntoId) next.set(asked, row.mergedIntoId);
      else {
        result.set(asked, {
          id: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          emailNormalized: row.emailNormalized,
          canonicalCompanyKey: row.companyKey === null ? null : (row.aliasTarget ?? row.companyKey),
        });
      }
    }
    pending = next;
  }
  for (const asked of pending.keys()) result.set(asked, undefined); // a merge chain longer than the cap
  return result;
}

/** Applies the Para rules to the record's contact plus the picked ids. The server is the authority; the client only sends ids. */
export async function resolveParaRecipients(primaryId: string, otherIds: readonly string[]): Promise<ParaResult> {
  const ids = [primaryId, ...otherIds];
  const people = await loadParaPeople(ids);
  return evaluatePara(people.get(primaryId), otherIds.map((id) => people.get(id)));
}

export interface ColleagueSuggestion {
  name: string;
  email: string;
}

/** CC suggestions: the BDs, whose address is on the internal domain. One small statement (the table has a handful of rows). */
export async function listColleagueSuggestions(): Promise<ColleagueSuggestion[]> {
  const rows = await db
    .select({ name: bd.name, email: bd.email })
    .from(bd)
    .where(sql`lower(${bd.email}) like ${"%@" + INTERNAL_CC_DOMAIN}`)
    .orderBy(asc(bd.name));
  return rows.map((r) => ({ name: r.name, email: r.email.trim().toLowerCase() }));
}

export interface ParaCandidate {
  id: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
}

// The canonical key of the record's company: its own key, or the company an alias key points at. NULL when the contact has no company.
const canonicalOf = (personId: string) =>
  sql`(select nullif(btrim(coalesce((select ${companyAlias.companyKey} from ${companyAlias} where ${companyAlias.aliasKey} = p0.company_key and ${aliasKeyIsNotLiveCompany()}), p0.company_key)), '') from person p0 where p0.id = ${personId}::uuid)`;

const CANDIDATE_LIMIT = 200;

/**
 * Picker contents: other live contacts of the same company (aliases included), with or without email (a contact without
 * email is listed so the BD knows it exists, but cannot be picked). One statement; empty for a contact without company.
 */
export async function listParaCandidates(personId: string): Promise<ParaCandidate[]> {
  const canonical = canonicalOf(personId);
  const rows = await db
    .select({ id: person.id, firstName: person.firstName, lastName: person.lastName, jobTitle: person.jobTitle, email: person.email })
    .from(person)
    .where(
      and(
        isNull(person.mergedIntoId),
        ne(person.id, personId),
        sql`${person.companyKey} in (select ${canonical} union select ${companyAlias.aliasKey} from ${companyAlias} where ${companyAlias.companyKey} = ${canonical} and ${aliasKeyIsNotLiveCompany()})`,
      ),
    )
    .orderBy(asc(person.lastName), asc(person.firstName), asc(person.id))
    .limit(CANDIDATE_LIMIT);
  return rows.map((r) => ({
    id: r.id,
    name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email || "",
    jobTitle: r.jobTitle,
    email: r.email?.trim() ? r.email.trim() : null,
  }));
}

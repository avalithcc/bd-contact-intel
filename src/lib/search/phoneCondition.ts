/**
 * SQL side of phone search (pure side: phoneQuery.ts). Matches `person.phone` and `person.mobile_phone` by digits.
 *
 * The suffix branch is `right(regexp_replace(col, '\D', '', 'g'), 8) = $1`, written EXACTLY like the expression of
 * the indexes in migration 0051 so Postgres can use them (a btree on the whole digit string, migration 0016, cannot
 * answer "ends with"). The contains branch (6-7 digit queries) has no index and scans the person table; it is bounded
 * by the 6-digit minimum and the table size (~27k rows).
 */
import { sql, or, type SQL } from "drizzle-orm";
import { person } from "@/db/schema";
import { PHONE_SUFFIX_LENGTH, parsePhoneSearch } from "@/lib/search/phoneQuery";

const NON_DIGITS = sql.raw(String.raw`'\D'`);
const SUFFIX_LEN = sql.raw(String(PHONE_SUFFIX_LENGTH));

function digitsOf(column: typeof person.phone | typeof person.mobilePhone) {
  return sql`regexp_replace(${column}, ${NON_DIGITS}, '', 'g')`;
}

/** The phone condition for a search-box query, or undefined when the query is not phone-like. */
export function phoneSearchCondition(q: string): SQL | undefined {
  const parsed = parsePhoneSearch(q);
  if (!parsed) return undefined;
  const columns = [person.phone, person.mobilePhone];
  if (parsed.mode === "suffix") {
    return or(...columns.map((c) => sql`right(${digitsOf(c)}, ${SUFFIX_LEN}) = ${parsed.suffix}`));
  }
  return or(...columns.map((c) => sql`position(${parsed.digits} in ${digitsOf(c)}) > 0`));
}

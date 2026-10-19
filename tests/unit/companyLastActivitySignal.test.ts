/**
 * `/companies` activity signal: `lastActivityAt` counts activity that reaches
 * a company directly (activity.company_key) or through one of its contacts
 * (activity.person_id -> person.company_key), and the list orders by it.
 * Db-free: everything renders through a QueryBuilder / PgDialect.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryBuilder, PgDialect } from "drizzle-orm/pg-core";
import { company } from "@/db/schema";
import { companyLastActivity, companyListOrderBy } from "@/lib/companies/lastActivitySignal";
import { parseDbTimestamp } from "@/lib/db/timestamp";

function renderPage() {
  const qb = new QueryBuilder();
  const la = companyLastActivity();
  const query = qb
    .with(la.direct, la.viaContact)
    .select({ companyKey: company.companyKey, lastActivityAt: la.lastActivityAt.as("last_activity_at") })
    .from(company)
    .leftJoin(la.direct, la.joinDirect)
    .leftJoin(la.viaContact, la.joinViaContact)
    .orderBy(...companyListOrderBy(la.lastActivityAt))
    .limit(50)
    .offset(100);
  return query.toSQL();
}

test("aggregates are CTEs grouped before the join to company, one row per key", () => {
  const { sql } = renderPage();
  assert.match(
    sql,
    /^with "pbc_direct" as \(select .*max\(.*\) as "pbc_direct_at".* from "activity" where .*"company_key" is not null group by "activity"."company_key"\)/is,
  );
  assert.match(
    sql,
    /"pbc_via_contact" as \(select .* from "activity" inner join "person" on .*"activity"."person_id" = "person"."id" where .*"person"."company_key" is not null group by "person"."company_key"\)/is,
  );
  // CTEs come first, the joins to them come after `from "company"`.
  assert.ok(sql.indexOf('"pbc_direct" as') < sql.indexOf('from "company"'));
  assert.match(sql, /from "company" left join "pbc_direct" on .* left join "pbc_via_contact" on/is);
});

test("effective time uses the shared helper (status_backfill originalAt) in both aggregates", () => {
  const { sql } = renderPage();
  assert.equal(sql.match(/= .status_backfill./g)?.length, 2); // one per helper expansion
});

test("lastActivityAt is the latest of the two aggregates", () => {
  const { sql } = renderPage();
  assert.match(sql, /greatest\("pbc_direct_at", "pbc_via_contact_at"\) as "last_activity_at"/i);
});

test("order: declared active clients last, then latest first, blanks last, then display_name and company_key tiebreaks", () => {
  const { sql } = renderPage();
  assert.match(
    sql,
    /order by case when "company"."client_status" = \$\d+ then 1 else 0 end, greatest\("pbc_direct_at", "pbc_via_contact_at"\) desc nulls last, "company"."display_name" asc, "company"."company_key" asc limit \$\d+ offset \$\d+$/i,
  );
});

// The point of the whole key: /companies is a prospecting list, and an active
// client is the company the BD emails most (invoices, collections, status), so
// "most recent activity first" pinned it to the top. This asserts the sink key
// is applied BEFORE the activity key, which is what actually demotes it — the
// two in the other order would leave the list exactly as it was.
test("the active-client key outranks the activity key, so a fresh invoice cannot lift a client back to the top", () => {
  const { sql } = renderPage();
  const orderBy = sql.slice(sql.toLowerCase().indexOf("order by"));
  const sinkAt = orderBy.indexOf("client_status");
  const activityAt = orderBy.indexOf("pbc_direct_at");
  // Both must be PRESENT before comparing. `indexOf` returns -1 for a missing
  // needle and `-1 < n` is true, so a bare `<` would pass vacuously for the
  // exact regression this test exists to catch: someone deleting the key.
  assert.ok(sinkAt >= 0, `the client_status ordering key is gone: ${orderBy}`);
  assert.ok(activityAt >= 0, `the activity ordering key is gone: ${orderBy}`);
  assert.ok(sinkAt < activityAt, `client_status must be the FIRST ordering key, got: ${orderBy}`);
});

test("only 'active' sinks: inactive and not-stated keep the normal activity order", () => {
  const la = companyLastActivity();
  const d = new PgDialect();
  const [sinkKey] = companyListOrderBy(la.lastActivityAt).map((s) => d.sqlToQuery(s));
  // `inactive` is a dormant client and a prime re-sell, and NULL means "not
  // stated / not a client" — neither may be demoted. One bound value only.
  assert.deepEqual(sinkKey!.params, ["active"]);
  assert.match(sinkKey!.sql, /case when "company"."client_status" = \$\d+ then 1 else 0 end/i);
});

test("companyListOrderBy is pure: two calls render identically", () => {
  const la = companyLastActivity();
  const d = new PgDialect();
  const a = companyListOrderBy(la.lastActivityAt).map((s) => d.sqlToQuery(s).sql);
  const b = companyListOrderBy(la.lastActivityAt).map((s) => d.sqlToQuery(s).sql);
  assert.deepEqual(a, b);
});

test("a postgres-js offset string from the greatest() expression is pinned to the real instant", () => {
  assert.equal(parseDbTimestamp("2026-09-25 13:30:00.123456+00").toISOString(), "2026-09-25T13:30:00.123Z");
  assert.equal(parseDbTimestamp("2026-09-25 13:30:00").toISOString(), "2026-09-25T13:30:00.000Z");
});

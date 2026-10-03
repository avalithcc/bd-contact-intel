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
  assert.equal(sql.match(/originalAt/g)?.length, 4); // 2 per helper expansion
});

test("lastActivityAt is the latest of the two aggregates", () => {
  const { sql } = renderPage();
  assert.match(sql, /greatest\("pbc_direct_at", "pbc_via_contact_at"\) as "last_activity_at"/i);
});

test("order: latest first, blanks last, then display_name and company_key tiebreaks", () => {
  const { sql } = renderPage();
  assert.match(
    sql,
    /order by greatest\("pbc_direct_at", "pbc_via_contact_at"\) desc nulls last, "company"."display_name" asc, "company"."company_key" asc limit \$\d+ offset \$\d+$/i,
  );
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

import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildRosterCandidatesQuery, clientStatusSql } from "@/lib/sequences/rosterQuery";

const render = (q: ReturnType<typeof buildRosterCandidatesQuery>) => new PgDialect().sqlToQuery(q);
const text = (q = buildRosterCandidatesQuery({ limit: 50 })) => render(q).sql.replace(/\s+/g, " ");

test("excludes merged, empty email, status none and pattern-inferred emails", () => {
  const sql = text();
  assert.match(sql, /p\.merged_into_id is null/);
  assert.match(sql, /btrim\(coalesce\(p\.email, ''\)\) <> ''/);
  assert.match(sql, /p\.email_status <> 'none'/);
  // Same rule as isReachable: pattern_inferred only counts once the status is verified.
  assert.match(sql, /\(p\.email_source is distinct from 'pattern_inferred' or p\.email_status = 'verified'\)/);
});

test("requires an open US IT posting, matched directly or through a company alias", () => {
  const sql = text();
  assert.match(sql, /jp\.is_it = true and jp\.closed_at is null and jp\.market = 'us'/);
  assert.match(sql, /company_alias/);
});

test("client exclusion is driven by client_status IS NOT NULL, so it covers active AND inactive", () => {
  const sql = text();
  assert.match(sql, /c\.client_status is not null/);
  assert.doesNotMatch(sql, /client_status\s*(=|<>|in)\s*\(?'(active|inactive)'/i);
  assert.match(new PgDialect().sqlToQuery(clientStatusSql).sql, /client_status/);
});

test("excludes suppressed addresses and domains", () => {
  const sql = text();
  assert.match(sql, /email_suppression/);
  assert.match(sql, /s\.kind = 'address'/);
  assert.match(sql, /s\.kind = 'domain'/);
});

test("labels Florida from job_posting.is_miami and never touches is_startup", () => {
  const sql = text();
  assert.match(sql, /bool_or\(jp\.is_miami\)/);
  assert.doesNotMatch(sql, /is_startup/);
  assert.doesNotMatch(sql, /startup/i);
});

test("limit is bound, not interpolated, and clamped to a sane range", () => {
  assert.deepEqual(render(buildRosterCandidatesQuery({ limit: 50 })).params.at(-1), 50);
  assert.deepEqual(render(buildRosterCandidatesQuery({ limit: 99999 })).params.at(-1), 200);
  assert.deepEqual(render(buildRosterCandidatesQuery({ limit: -4 })).params.at(-1), 1);
});

test("an optional search term filters by name or company with a bound parameter", () => {
  const q = render(buildRosterCandidatesQuery({ limit: 10, search: "twil" }));
  assert.ok(q.params.includes("%twil%"));
  assert.doesNotMatch(q.sql, /twil/);
});

test("the company NAME is resolved like the Contacts list: canonical name through company_key for a null free text", () => {
  const sql = text(buildRosterCandidatesQuery({ limit: 10, search: "acme" }));
  assert.match(sql, /left join company cn on cn\.company_key = p\.company_key/);
  assert.match(sql, /cn\.display_name as "companyCanonicalName"/);
});

test("ordering follows the name the user SEES: free text, else the canonical name", () => {
  assert.match(text(), /order by coalesce\(p\.company, cn\.display_name\), p\.last_name/);
});

test("search reuses the Contacts list company match (what is displayed), not the raw column", () => {
  const q = render(buildRosterCandidatesQuery({ limit: 10, search: "acme" }));
  const sql = q.sql.replace(/\s+/g, " ");
  assert.doesNotMatch(sql, /concat_ws\(' ', p\.first_name, p\.last_name, p\.company\)/);
  assert.match(sql, /p\.company ilike \$\d+ or \(\(p\.company is null or p\.company = ''\) and exists \(select 1 from "company" where "company"\."company_key" = p\.company_key and "company"\."display_name" ilike \$\d+\)\)/);
});

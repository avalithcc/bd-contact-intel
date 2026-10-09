/**
 * Guards the list's contact-count WIRING, which the query-level tests cannot:
 * reverting `listQueries.ts` to a plain `inArray(person.companyKey, keys)` count
 * left every other unit test green. Two layers:
 *  - `countContactsByCompany` (the orchestrator) is run with fake readers, so
 *    dropping the alias read, the widened key set or the per-company fold fails.
 *  - `listQueries.ts` is checked at source level to delegate to it and not to
 *    count `person` rows itself (it imports the real db, so it cannot be run).
 * The alias rule is one SQL fragment shared by the list's alias read and the
 * record's condition; the last tests pin that both render it identically.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { and, inArray } from "drizzle-orm";
import { PgDialect, QueryBuilder } from "drizzle-orm/pg-core";
import { companyAlias, person } from "@/db/schema";
import { aliasKeyIsNotLiveCompany } from "@/lib/companies/aliasRule";
import { companyContactsCondition, countContactsByCompany } from "@/lib/companies/contactCounts";

test("the list count reads aliases once for the page's keys, then counts the widened key set once", async () => {
  const aliasCalls: string[][] = [];
  const countCalls: string[][] = [];
  const totals = await countContactsByCompany(["acme", "globex"], {
    readAliasRows: async (keys) => {
      aliasCalls.push([...keys]);
      return [{ aliasKey: "acme-legal", companyKey: "acme" }];
    },
    readCounts: async (keys) => {
      countCalls.push([...keys]);
      return [
        { companyKey: "acme", count: 4 },
        { companyKey: "acme-legal", count: 2 },
        { companyKey: "globex", count: 1 },
      ];
    },
  });
  assert.deepEqual(aliasCalls, [["acme", "globex"]]);
  assert.equal(countCalls.length, 1);
  assert.deepEqual([...countCalls[0]!].sort(), ["acme", "acme-legal", "globex"]);
  assert.equal(totals.get("acme"), 6);
  assert.equal(totals.get("globex"), 1);
});

test("an empty page issues no reads", async () => {
  let calls = 0;
  const reader = async () => {
    calls++;
    return [];
  };
  const totals = await countContactsByCompany([], { readAliasRows: reader, readCounts: reader });
  assert.equal(totals.size, 0);
  assert.equal(calls, 0);
});

test("listQueries delegates the count to countContactsByCompany and never counts person rows itself", () => {
  const src = readFileSync("src/lib/companies/listQueries.ts", "utf8");
  assert.match(src, /countContactsByCompany\(/);
  assert.match(src, /readAliasRows:\s*getCompanyAliasRows/);
  assert.match(src, /companyContactCountsQuery\(db,/);
  assert.doesNotMatch(src, /from\(person\)/);
  assert.doesNotMatch(src, /person\.companyKey/);
});

test("the alias read and the record's condition apply the same live-company rule", () => {
  const dialect = new PgDialect();
  const fragment = dialect.sqlToQuery(aliasKeyIsNotLiveCompany()).sql;
  assert.match(fragment, /not exists \(select 1 from "company" where "company"\."company_key" = "company_alias"\."alias_key"\)/);

  const listRead = new QueryBuilder()
    .select({ aliasKey: companyAlias.aliasKey })
    .from(companyAlias)
    .where(and(inArray(companyAlias.companyKey, ["acme"]), aliasKeyIsNotLiveCompany()))
    .toSQL().sql;
  const record = new QueryBuilder().select({ id: person.id }).from(person).where(companyContactsCondition("acme")).toSQL().sql;
  assert.ok(listRead.includes(fragment), "list alias read must carry the shared rule");
  assert.ok(record.includes(fragment), "record condition must carry the shared rule");
});

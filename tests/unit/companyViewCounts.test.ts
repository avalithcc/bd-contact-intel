import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { buildCompanyViewCountsSelection } from "@/lib/companies/viewCounts";

const dialect = new PgDialect();
const ME = "00000000-0000-4000-8000-0000000000ff";
const compile = (s: SQL) => dialect.sqlToQuery(s);
const norm = (t: string) => t.replace(/\s+/g, " ").trim();

describe("buildCompanyViewCountsSelection", () => {
  it("no search: all is a bare count, mine and hiring are filtered counts", () => {
    const sel = buildCompanyViewCountsSelection(ME, ["a", "b"], undefined);
    const all = compile(sel.all);
    const mine = compile(sel.mine);
    const hiring = compile(sel.hiring);
    assert.equal(norm(all.sql), "count(*)::int");
    assert.deepEqual(all.params, []);
    assert.equal(norm(mine.sql), 'count(*) filter (where "company"."owner_bd_id" = $1)::int');
    assert.deepEqual(mine.params, [ME]);
    assert.equal(norm(hiring.sql), 'count(*) filter (where "company"."company_key" in ($1, $2))::int');
    assert.deepEqual(hiring.params, ["a", "b"]);
  });

  it("empty hiring set: emits a literal 0, never an empty IN list", () => {
    const sel = buildCompanyViewCountsSelection(ME, [], undefined);
    const hiring = compile(sel.hiring);
    assert.equal(norm(hiring.sql), "0::int");
    assert.deepEqual(hiring.params, []);
    assert.doesNotMatch(norm(hiring.sql), /\bin\s*\(\s*\)/i);
  });

  it("with a search term: every count carries the identical search predicate, ANDed for mine/hiring", () => {
    const sel = buildCompanyViewCountsSelection(ME, ["a"], "acme");
    const all = compile(sel.all);
    const mine = compile(sel.mine);
    const hiring = compile(sel.hiring);
    assert.match(norm(all.sql), /^count\(\*\) filter \(where \(\(unaccent\(/);
    const searchSql = norm(all.sql).replace(/^count\(\*\) filter \(where (.*)\)::int$/, "$1");
    // $n placeholders differ by position; compare with the numbers stripped.
    const strip = (t: string) => t.replace(/\$\d+/g, "$?");
    assert.ok(strip(norm(mine.sql)).includes(strip(searchSql)));
    assert.ok(strip(norm(hiring.sql)).includes(strip(searchSql)));
    assert.match(norm(mine.sql), /"company"\."owner_bd_id" = \$1 and /);
    assert.match(norm(hiring.sql), /"company"\."company_key" in \(\$1\) and /);
    // Same search params, in the same order, after the leading owner / key params.
    assert.deepEqual(mine.params.slice(1), all.params);
    assert.deepEqual(hiring.params.slice(1), all.params);
  });

  it("empty hiring set with a search term is still a literal 0 (the search cannot make it non-zero)", () => {
    const sel = buildCompanyViewCountsSelection(ME, [], "acme");
    assert.equal(norm(compile(sel.hiring).sql), "0::int");
  });

  it("does not mutate the hiring key list it is given, and is stable across calls", () => {
    const keys = ["a", "b"];
    const first = buildCompanyViewCountsSelection(ME, keys, "acme");
    const second = buildCompanyViewCountsSelection(ME, keys, "acme");
    assert.deepEqual(keys, ["a", "b"]);
    assert.deepEqual(compile(first.hiring), compile(second.hiring));
    assert.deepEqual(compile(first.mine), compile(second.mine));
    assert.deepEqual(compile(first.all), compile(second.all));
  });
});

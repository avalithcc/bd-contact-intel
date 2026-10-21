import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { companyOpenTasksCondition, companyTimelineBaseWhere } from "@/lib/companies/recordConditions";

const dialect = new PgDialect();
const compile = (s: SQL | undefined) => dialect.sqlToQuery(s!);
const norm = (t: string) => t.replace(/\s+/g, " ").trim();
const IDS = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];

describe("companyTimelineBaseWhere", () => {
  it("with people: company row OR any listed person", () => {
    const q = compile(companyTimelineBaseWhere("acme", IDS));
    assert.match(norm(q.sql), /^\(\("activity"\."company_key" = \$1 or "activity"\."person_id" in \(\$2, \$3\)\) and not /);
    assert.deepEqual(q.params.slice(0, 3), ["acme", ...IDS]);
  });

  it("with an EMPTY person list: company row only, never an empty IN list", () => {
    const q = compile(companyTimelineBaseWhere("acme", []));
    assert.doesNotMatch(norm(q.sql), /\bin\s*\(\s*\)/i);
    assert.doesNotMatch(norm(q.sql), /person_id" in/);
    assert.match(norm(q.sql), /^\("activity"\."company_key" = \$1 and not /);
    assert.equal(q.params[0], "acme");
  });

  it("never mutates its input and gives the same result when called twice with it", () => {
    const ids = [...IDS];
    const a = compile(companyTimelineBaseWhere("acme", ids));
    const b = compile(companyTimelineBaseWhere("acme", ids));
    assert.deepEqual(ids, IDS);
    assert.deepEqual(a, b);
  });
});

describe("companyOpenTasksCondition", () => {
  it("with people: open AND (company task OR a task of a listed person)", () => {
    const q = compile(companyOpenTasksCondition("acme", IDS));
    assert.equal(
      norm(q.sql),
      '("task"."status" = $1 and ("task"."company_key" = $2 or "task"."person_id" in ($3, $4)))',
    );
    assert.deepEqual(q.params, ["open", "acme", ...IDS]);
  });

  it("with an EMPTY person list: open company tasks only, no IN", () => {
    const q = compile(companyOpenTasksCondition("acme", []));
    assert.equal(norm(q.sql), '("task"."status" = $1 and "task"."company_key" = $2)');
    assert.deepEqual(q.params, ["open", "acme"]);
  });

  it("never mutates its input and is stable across calls", () => {
    const ids = [...IDS];
    const a = compile(companyOpenTasksCondition("acme", ids));
    const b = compile(companyOpenTasksCondition("acme", ids));
    assert.deepEqual(ids, IDS);
    assert.deepEqual(a, b);
  });
});

import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  FRESH_POSTING_WINDOW_DAYS,
  openFreshPostingCondition,
  openFreshPostingSql,
  openPostingSql,
} from "@/lib/hiring/openPosting";

const render = (q: Parameters<PgDialect["sqlToQuery"]>[0]) => new PgDialect().sqlToQuery(q).sql.replace(/\s+/g, " ");

test("the window is 30 days and the SQL states it", () => {
  assert.equal(FRESH_POSTING_WINDOW_DAYS, 30);
  assert.equal(
    render(openFreshPostingSql("jp")),
    "(jp.closed_at is null and least(jp.posted_at, jp.first_seen) >= now() - interval '30 days')",
  );
});

test("the alias is honoured and an unsafe alias is rejected", () => {
  assert.match(render(openFreshPostingSql("jp2")), /^\(jp2\.closed_at is null and least\(jp2\.posted_at, jp2\.first_seen\)/);
  assert.throws(() => openFreshPostingSql("jp; drop table x"));
});

test("the drizzle twin states the same rule over the typed columns", () => {
  const twin = render(openFreshPostingCondition());
  assert.match(twin, /"job_posting"\."closed_at" is null/);
  assert.match(twin, /least\("job_posting"\."posted_at", "job_posting"\."first_seen"\) >= now\(\) - interval '30 days'/);
});

test("composing the fragment twice yields the same SQL (no shared mutable state)", () => {
  assert.equal(render(sql`${openFreshPostingSql()} and ${openFreshPostingSql()}`), render(sql`${openFreshPostingSql()} and ${openFreshPostingSql()}`));
});

test("openPostingSql is open-only: no freshness window", () => {
  assert.equal(render(openPostingSql("jp")), "jp.closed_at is null");
});

test("posting_markets (recipient geography) never carries the freshness window", () => {
  for (const f of ["seedQueries", "releaseQueries", "draftQueries"]) {
    const text = readFileSync(`src/lib/sequences/${f}.ts`, "utf8");
    const m = text.match(/json_agg\(distinct jp\.market\)[\s\S]*?as posting_markets/);
    assert.ok(m, `${f}: posting_markets expression`);
    assert.match(m[0], /openPostingSql\(/, f);
    assert.doesNotMatch(m[0], /openFreshPostingSql/, f);
  }
});

test("no source reintroduces a bare open-posting predicate outside the shared helper", () => {
  const allowed = new Map([
    ["src/lib/hiring/openPosting.ts", "the rule itself"],
    ["src/lib/hiring/sync.ts", "closes rows: a write, not a read of what counts"],
    ["src/lib/hiring/startupClassification.ts", "orders which posting to sample for classification; counts nothing"],
  ]);
  const files = [...globSync("src/**/*.ts"), ...globSync("src/**/*.tsx"), ...globSync("scripts/**/*.ts")].filter(
    (f) => !/\.test\.tsx?$/.test(f) && !allowed.has(relative(".", f)),
  );
  const patterns = [/closed_at\s+is\s+null/i, /closedAt\}?\s+is\s+null/i, /isNull\([^)]*closedAt/];
  const offenders: string[] = [];
  for (const file of files) {
    // Whole-file scan on comment-stripped text so a predicate split across lines cannot hide.
    const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (patterns.some((re) => re.test(text))) offenders.push(file);
  }
  assert.deepEqual(offenders, [], "route these through src/lib/hiring/openPosting.ts");
});

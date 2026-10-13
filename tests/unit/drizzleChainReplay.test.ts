/**
 * Guards the one property nothing else in the repo checks: that
 * `npm run db:migrate` can build the database from EMPTY.
 *
 * On an empty database the migrator's `when` high-water mark is absent, so it
 * applies every journal entry in array order; the chain therefore has to be
 * self-contained. It was not — `bd` and `contact` were created by
 * `drizzle-kit push` before the chain existed, so idx 0 opened with
 * `ALTER TABLE "contact"` and a fresh database died with 42P01.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { describeUnresolvedTableRefs, findUnresolvedTableRefs } from "../../src/lib/migration/chainReplay";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: { tag: string }[];
};

const chain = journal.entries.map((entry) => ({
  tag: entry.tag,
  sql: readFileSync(`drizzle/${entry.tag}.sql`, "utf8"),
}));

test("the migration chain creates every table it touches, in journal order", () => {
  const unresolved = findUnresolvedTableRefs(chain);
  assert.deepEqual(unresolved, [], describeUnresolvedTableRefs(unresolved));
});

test("the chain creates the genesis tables bd and contact", () => {
  // They predate the chain; without them an empty database cannot be built.
  const createdSomewhere = (table: string) =>
    chain.some((file) => new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`).test(file.sql));
  assert.ok(createdSomewhere("bd"), 'no migration creates "bd"');
  assert.ok(createdSomewhere("contact"), 'no migration creates "contact"');
});

test("findUnresolvedTableRefs accepts a table created earlier in the same file", () => {
  const unresolved = findUnresolvedTableRefs([
    { tag: "t", sql: 'CREATE TABLE IF NOT EXISTS "a" ("id" uuid);\n--> statement-breakpoint\nALTER TABLE "a" ADD COLUMN "b" text;' },
  ]);
  assert.deepEqual(unresolved, []);
});

test("findUnresolvedTableRefs reports a table that no earlier statement created", () => {
  const unresolved = findUnresolvedTableRefs([{ tag: "t", sql: 'ALTER TABLE "public"."ghost" ENABLE ROW LEVEL SECURITY;' }]);
  assert.deepEqual(unresolved, [
    { tag: "t", table: "ghost", statement: 'ALTER TABLE "public"."ghost" ENABLE ROW LEVEL SECURITY;' },
  ]);
});

test("findUnresolvedTableRefs ignores table names that only appear in comments", () => {
  const unresolved = findUnresolvedTableRefs([{ tag: "t", sql: '-- ALTER TABLE "ghost" is only described here\nSELECT 1;' }]);
  assert.deepEqual(unresolved, []);
});

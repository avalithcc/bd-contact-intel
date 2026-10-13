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

const refs = (sql: string) => findUnresolvedTableRefs([{ tag: "t", sql }]).map((ref) => ref.table);

test("the real drizzle/0039 unquoted ALTER TABLE / REFERENCES style is seen by the guard", () => {
  // 0039 writes `ALTER TABLE public.company_alias` and `REFERENCES public.company(...)` unquoted,
  // inside a DO block. Remove the migration that creates company_alias (0003) from the REAL chain
  // and 0039 must be reported; before the guard read unquoted identifiers it was invisible.
  const withoutCreator = chain.filter((file) => !file.tag.startsWith("0003_"));
  const unresolved = findUnresolvedTableRefs(withoutCreator);
  assert.ok(
    unresolved.some((ref) => ref.tag.startsWith("0039_") && ref.table === "company_alias"),
    `0039 was not reported; got ${JSON.stringify(unresolved.map((ref) => `${ref.tag}:${ref.table}`))}`,
  );
});

test("the real drizzle/0039 on its own reports both tables it touches", () => {
  const file = chain.find((entry) => entry.tag.startsWith("0039_"));
  assert.ok(file, "0039 missing from the journal");
  assert.deepEqual(refs(file.sql).sort(), ["company", "company_alias"]);
});

test("unquoted ALTER TABLE and REFERENCES are seen, with or without the public schema", () => {
  assert.deepEqual(refs("ALTER TABLE new_thing ADD COLUMN x int;"), ["new_thing"]);
  assert.deepEqual(refs("ALTER TABLE public.new_thing ADD COLUMN x int;"), ["new_thing"]);
  assert.deepEqual(refs('CREATE TABLE "a" ("id" uuid REFERENCES public.ghost(id));'), ["ghost"]);
  assert.deepEqual(refs('CREATE TABLE "a" ("id" uuid REFERENCES ghost(id));'), ["ghost"]);
});

test("an unquoted CREATE TABLE satisfies later references, quoted or not", () => {
  assert.deepEqual(refs('CREATE TABLE IF NOT EXISTS public.a (id uuid);\n--> statement-breakpoint\nALTER TABLE "a" ADD COLUMN b int;'), []);
});

test("identifiers are case-folded the way Postgres does for unquoted names", () => {
  assert.deepEqual(refs('CREATE TABLE "a" (id uuid);\n--> statement-breakpoint\nALTER TABLE A ADD COLUMN b int;'), []);
});

test("a table in another schema is not a public table", () => {
  assert.deepEqual(refs('ALTER TABLE "auth"."users" ADD COLUMN x int;\nALTER TABLE auth.users ADD COLUMN y int;'), []);
});

test("ON UPDATE / DO UPDATE SET are not mistaken for an UPDATE statement", () => {
  assert.deepEqual(
    refs('CREATE TABLE "a" ("id" uuid, "b" uuid REFERENCES "a"("id") ON DELETE cascade ON UPDATE no action);\n--> statement-breakpoint\nINSERT INTO "a" VALUES (1) ON CONFLICT DO UPDATE SET id = 2;'),
    [],
  );
});

test("DROP TABLE clears the table, so a later reference is reported", () => {
  const sql = 'CREATE TABLE "a" (id uuid);\n--> statement-breakpoint\nDROP TABLE "a";\n--> statement-breakpoint\nALTER TABLE "a" ADD COLUMN b int;';
  assert.deepEqual(refs(sql), ["a"]);
});

test("DROP TABLE of a missing table is reported unless it says IF EXISTS", () => {
  assert.deepEqual(refs('DROP TABLE "ghost";'), ["ghost"]);
  assert.deepEqual(refs('DROP TABLE IF EXISTS "ghost";'), []);
});

test("a table dropped and created again is available afterwards", () => {
  const sql = 'CREATE TABLE "a" (id uuid);\n--> statement-breakpoint\nDROP TABLE "a", "b";\n--> statement-breakpoint\nCREATE TABLE "a" (id uuid);\n--> statement-breakpoint\nALTER TABLE "a" ADD COLUMN c int;';
  assert.deepEqual(refs(sql), ["b"]);
});

test("a reference before its CREATE inside one breakpoint chunk is reported", () => {
  const sql = 'DO $$ BEGIN\n  ALTER TABLE "a" ADD COLUMN b int;\n  CREATE TABLE "a" (id uuid);\nEND $$;';
  assert.deepEqual(refs(sql), ["a"]);
});

test("a CREATE before the reference inside one chunk is accepted, including self references", () => {
  assert.deepEqual(refs('DO $$ BEGIN\n  CREATE TABLE "a" (id uuid);\n  ALTER TABLE "a" ADD COLUMN b int;\nEND $$;'), []);
  assert.deepEqual(refs('CREATE TABLE "a" ("id" uuid, "p" uuid REFERENCES "a"("id"));'), []);
});

test("a standalone `--> statement-breakpoint` line still splits statements", () => {
  const unresolved = findUnresolvedTableRefs([
    { tag: "t", sql: 'ALTER TABLE "x" ADD COLUMN a int;\n--> statement-breakpoint\nALTER TABLE "y" ADD COLUMN b int;' },
  ]);
  assert.deepEqual(unresolved.map((ref) => [ref.table, ref.statement]), [
    ["x", 'ALTER TABLE "x" ADD COLUMN a int;'],
    ["y", 'ALTER TABLE "y" ADD COLUMN b int;'],
  ]);
});

test("DELETE FROM, TRUNCATE and COMMENT ON TABLE need the table to exist", () => {
  assert.deepEqual(refs('DELETE FROM "g1";'), ["g1"]);
  assert.deepEqual(refs("DELETE FROM ONLY public.g2 WHERE true;"), ["g2"]);
  assert.deepEqual(refs('TRUNCATE TABLE "g3";'), ["g3"]);
  assert.deepEqual(refs("TRUNCATE g4;"), ["g4"]);
  assert.deepEqual(refs("COMMENT ON TABLE g5 IS 'x';"), ["g5"]);
});

test("CREATE INDEX is checked whether the index name is quoted, bare or absent", () => {
  assert.deepEqual(refs('CREATE INDEX "i" ON "g1" ("c");'), ["g1"]);
  assert.deepEqual(refs("CREATE INDEX i ON g2 (c);"), ["g2"]);
  assert.deepEqual(refs("CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS i ON ONLY public.g3 (c);"), ["g3"]);
  assert.deepEqual(refs("CREATE INDEX ON g4 (c);"), ["g4"]);
});

test("block comments carry no statements", () => {
  assert.deepEqual(refs('/* ALTER TABLE "ghost" ADD COLUMN x int;\n   DELETE FROM g2; */\nSELECT 1;'), []);
});

test("the planner is pure: same input twice gives the same result and the input is untouched", () => {
  const input = [
    { tag: "a", sql: 'CREATE TABLE "a" (id uuid);\n--> statement-breakpoint\nALTER TABLE ghost ADD COLUMN x int;' },
    { tag: "b", sql: 'DROP TABLE "a";\n--> statement-breakpoint\nALTER TABLE "a" ADD COLUMN y int;' },
  ];
  const frozen = JSON.stringify(input);
  const first = findUnresolvedTableRefs(input);
  const second = findUnresolvedTableRefs(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), frozen);
  assert.deepEqual(first.map((ref) => ref.table), ["ghost", "a"]);
});

const withA = (sql: string) => `CREATE TABLE "a" (id uuid);\n--> statement-breakpoint\n${sql}`;

test("a privilege list or trigger event followed by ON is not a table named `on`", () => {
  assert.deepEqual(refs(withA("GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE a TO anon;")), []);
  assert.deepEqual(refs(withA("REVOKE UPDATE ON TABLE a FROM anon;")), []);
  assert.deepEqual(refs(withA("GRANT REFERENCES, TRUNCATE ON TABLE a TO anon;")), []);
  assert.deepEqual(refs(withA("CREATE TRIGGER t AFTER TRUNCATE ON a FOR EACH STATEMENT EXECUTE FUNCTION f();")), []);
});

test("a trailing `-- comment` carries no table names", () => {
  assert.deepEqual(refs('CREATE TABLE "a" (id uuid, company_id uuid, -- references company\n  x int);'), []);
  assert.deepEqual(refs(withA("ALTER TABLE a ADD y int; -- ALTER TABLE ghost")), []);
});

test("comment stripping is a single left-to-right pass, so `/*` inside a line comment opens nothing", () => {
  assert.deepEqual(refs("-- see /* below\nALTER TABLE ghost ADD x int;\n-- end */"), ["ghost"]);
  assert.deepEqual(refs("/* a -- b */ ALTER TABLE ghost ADD x int;"), ["ghost"]);
  assert.deepEqual(refs("/* outer /* inner */ still comment ALTER TABLE hidden ADD x int; */ ALTER TABLE ghost ADD x int;"), ["ghost"]);
});

test("`--` inside a string literal or a quoted identifier does not hide the rest of the line", () => {
  assert.deepEqual(refs("ALTER TABLE a ADD x text DEFAULT '--'; ALTER TABLE ghost ADD y int;"), ["a", "ghost"]);
  assert.deepEqual(refs('ALTER TABLE "we--ird" ADD x int;'), ["we--ird"]);
});

test("TRUNCATE takes a comma list like DROP TABLE does", () => {
  assert.deepEqual(refs(withA("TRUNCATE a, b;")), ["b"]);
  assert.deepEqual(refs("TRUNCATE TABLE ONLY g1, public.g2 RESTART IDENTITY CASCADE;"), ["g1", "g2"]);
});

test("a table read through FROM / USING inside INSERT, UPDATE or DELETE is checked", () => {
  assert.deepEqual(refs(withA("INSERT INTO a SELECT x FROM ghost;")), ["ghost"]);
  assert.deepEqual(refs(withA("UPDATE a SET x = g.x FROM ghost g WHERE g.id = a.id;")), ["ghost"]);
  assert.deepEqual(refs(withA("DELETE FROM a USING ghost WHERE ghost.id = a.id;")), ["ghost"]);
  assert.deepEqual(refs(withA("INSERT INTO a SELECT x FROM b JOIN c ON true, d;")), ["b"]);
});

test("FROM that is not a table read stays quiet", () => {
  assert.deepEqual(refs(withA("UPDATE a SET x = 1 WHERE y IS DISTINCT FROM z;")), []);
  assert.deepEqual(refs(withA("INSERT INTO a SELECT * FROM generate_series(1, 3);")), []);
  assert.deepEqual(refs(withA("INSERT INTO a SELECT * FROM (SELECT 1) s;")), []);
  assert.deepEqual(refs("SELECT 1 FROM ghost;"), []);
});

test("a table that exists is not reported when read through FROM", () => {
  assert.deepEqual(refs(`CREATE TABLE "b" (id uuid);\n--> statement-breakpoint\n${withA("INSERT INTO a SELECT x FROM public.b;")}`), []);
});

/**
 * Static replayability check for the drizzle migration chain.
 *
 * `drizzle-kit migrate` against an EMPTY database applies every journal entry
 * in array order (the `when` high-water mark only gates databases that already
 * have rows in `drizzle.__drizzle_migrations` — see
 * node_modules/drizzle-orm/pg-core/dialect.js, PgDialect.migrate). So the chain
 * must be self-contained: no statement may touch a table that no earlier
 * statement created.
 *
 * It was not. `drizzle/0000_crazy_wind_dancer.sql` opened with
 * `ALTER TABLE "contact"`, because `bd` and `contact` had been created with
 * `drizzle-kit push` before the chain existed, so a fresh database died with
 * `PostgresError: relation "contact" does not exist` (42P01). This check turns
 * that into a unit-test failure instead of a discovery made while standing up
 * a new environment.
 */

/** One journal entry's SQL, in journal order. */
export interface ChainFile {
  tag: string;
  sql: string;
}

/** A statement that touches a table no earlier statement created. */
export interface UnresolvedTableRef {
  tag: string;
  table: string;
  statement: string;
}

/** `"table"` or `"public"."table"`, as drizzle-kit emits them. */
const TABLE = '(?:"public"\\s*\\.\\s*)?"([a-z_][a-z0-9_]*)"';

const CREATES = new RegExp(`\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${TABLE}`, "gi");

/** Every shape in this chain that requires the table to exist already. */
const REFERENCES = [
  new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${TABLE}`, "gi"),
  new RegExp(`\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?"[^"]+"\\s+ON\\s+(?:ONLY\\s+)?${TABLE}`, "gi"),
  new RegExp(`\\bREFERENCES\\s+${TABLE}`, "gi"),
  new RegExp(`\\bUPDATE\\s+(?:ONLY\\s+)?${TABLE}`, "gi"),
  new RegExp(`\\bINSERT\\s+INTO\\s+${TABLE}`, "gi"),
];

/** Line comments carry table names in prose; they are not statements. */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => (line.trimStart().startsWith("--") ? "" : line))
    .join("\n");
}

function matchAll(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

/** Collapses whitespace so a failure message stays on one line. */
function oneLine(statement: string): string {
  const flat = statement.trim().replace(/\s+/g, " ");
  return flat.length > 120 ? `${flat.slice(0, 117)}...` : flat;
}

/**
 * Replays the chain statement by statement, tracking which tables exist.
 * An empty result means a fresh database can run the whole chain in order.
 */
export function findUnresolvedTableRefs(files: readonly ChainFile[]): UnresolvedTableRef[] {
  const created = new Set<string>();
  const unresolved: UnresolvedTableRef[] = [];

  for (const file of files) {
    for (const statement of stripComments(file.sql).split("--> statement-breakpoint")) {
      if (!statement.trim()) continue;
      const creates = matchAll(CREATES, statement);
      const referenced = new Set(REFERENCES.flatMap((pattern) => matchAll(pattern, statement)));
      for (const table of referenced) {
        if (created.has(table) || creates.includes(table)) continue;
        unresolved.push({ tag: file.tag, table, statement: oneLine(statement) });
      }
      for (const table of creates) created.add(table);
    }
  }

  return unresolved;
}

/** The failure message, with the fix recipe, so the test body stays one line. */
export function describeUnresolvedTableRefs(unresolved: readonly UnresolvedTableRef[]): string {
  if (unresolved.length === 0) return "";
  const lines = unresolved.map((ref) => `  ${ref.tag}: table "${ref.table}" does not exist yet — ${ref.statement}`);
  return (
    `${unresolved.length} statement(s) touch a table no earlier migration creates, so ` +
    `\`npm run db:migrate\` against an empty database fails with 42P01:\n${lines.join("\n")}\n` +
    `Fix: add the missing \`CREATE TABLE IF NOT EXISTS\` to the earliest migration that needs it. ` +
    `Editing an already-applied .sql file is safe — the migrator stores each file's hash but never ` +
    `compares it (node_modules/drizzle-orm/pg-core/dialect.js, PgDialect.migrate), and production skips ` +
    `every entry whose journal \`when\` is below its latest applied created_at. Do NOT add a new journal ` +
    `entry before an existing one: idx values must stay sequential (tests/unit/drizzleJournal.test.ts).`
  );
}

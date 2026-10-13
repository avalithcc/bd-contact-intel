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
 *
 * WHAT THIS DOES NOT COVER. It is a tripwire for ONE failure class, and nothing
 * else: a statement touching a TABLE that no earlier statement created. It does
 * not see a missing column, enum/type, extension, function, schema or ROLE, nor
 * anything built dynamically (`EXECUTE format('CREATE TABLE %I', ...)`), a
 * `GRANT`, trigger or view body, `CREATE TABLE ... (LIKE x)`, or a table
 * renamed with `RENAME TO`. The second blocker that actually broke the build
 * from empty — `0019` granting to the `anon` role, which a plain Postgres does
 * not have — is exactly that kind of miss and would pass this check. A green
 * result here does NOT mean `db:migrate` builds from empty; only running it
 * against an empty database proves that (there is no CI in this repo).
 *
 * It is regex-based and deliberately over-reports rather than under-reports: it
 * would rather flag a harmless line than miss a broken one. It reads quoted and
 * unquoted identifiers (drizzle-kit emits quoted, hand-written migrations such
 * as 0039 do not), with or without `public.`; names in other schemas are
 * ignored. Within one statement it replays events in source order, so a
 * reference before its own CREATE is caught and a DROP TABLE un-creates.
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

/** One identifier: `"quoted"` (any characters) or bare (folded to lower case by Postgres). */
const NAME = '(?:"[^"]+"|[a-z_][a-z0-9_]*)';

/** An optionally schema-qualified table name, captured whole; see `resolveTable`. */
const TABLE = `(${NAME}(?:\\s*\\.\\s*${NAME})?)`;

const CREATES = new RegExp(`\\bCREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${TABLE}`, "gi");

/** `DROP TABLE [IF EXISTS] a, b`: group 1 is the IF EXISTS clause, group 2 the name list. */
const DROPS = new RegExp(`\\bDROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?(${NAME}(?:\\s*\\.\\s*${NAME})?(?:\\s*,\\s*${NAME}(?:\\s*\\.\\s*${NAME})?)*)`, "gi");

/** Every shape that requires the table to exist already. Capture group 1 is the table. */
const REFERENCES = [
  new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${TABLE}`, "gi"),
  new RegExp(`\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:${NAME}\\s+)?ON\\s+(?:ONLY\\s+)?${TABLE}`, "gi"),
  new RegExp(`\\bREFERENCES\\s+${TABLE}`, "gi"),
  // `ON UPDATE no action` and `DO UPDATE SET` are clauses, not statements.
  new RegExp(`(?<!\\b(?:ON|DO|FOR|OF|OR|BEFORE|AFTER)\\s+)\\bUPDATE\\s+(?:ONLY\\s+)?(?!SET\\b)${TABLE}`, "gi"),
  new RegExp(`\\bINSERT\\s+INTO\\s+${TABLE}`, "gi"),
  new RegExp(`\\bDELETE\\s+FROM\\s+(?:ONLY\\s+)?${TABLE}`, "gi"),
  new RegExp(`\\bTRUNCATE\\s+(?:TABLE\\s+)?(?:ONLY\\s+)?${TABLE}`, "gi"),
  new RegExp(`\\bCOMMENT\\s+ON\\s+TABLE\\s+${TABLE}`, "gi"),
];

/** drizzle-kit's own splitter: the marker may end a line or stand alone on one. */
const BREAKPOINT = "--> statement-breakpoint";

/** Line and block comments carry table names in prose; they are not statements. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => (line.trimStart().startsWith("--") ? "" : line))
    .join("\n");
}

/**
 * `"public"."t"`, `public.t`, `"t"`, `T` -> `t`. Returns null for another schema:
 * it is not a table this chain owns. Bare names fold to lower case, quoted ones do not.
 */
function resolveTable(raw: string): string | null {
  const parts = raw.match(new RegExp(NAME, "gi")) ?? [];
  const names = parts.map((part) => (part.startsWith('"') ? part.slice(1, -1) : part.toLowerCase()));
  if (names.length === 2) return names[0] === "public" ? names[1] : null;
  return names[0] ?? null;
}

/** Collapses whitespace so a failure message stays on one line. */
function oneLine(statement: string): string {
  const flat = statement.trim().replace(/\s+/g, " ");
  return flat.length > 120 ? `${flat.slice(0, 117)}...` : flat;
}

interface TableEvent {
  at: number;
  kind: "create" | "drop" | "touch";
  table: string;
}

/** Every create / drop / touch in one statement, with its source position. */
function eventsOf(statement: string): TableEvent[] {
  const events: TableEvent[] = [];
  const add = (at: number | undefined, kind: TableEvent["kind"], raw: string) => {
    const table = resolveTable(raw);
    if (table !== null) events.push({ at: at ?? 0, kind, table });
  };
  for (const match of statement.matchAll(CREATES)) add(match.index, "create", match[1]);
  for (const match of statement.matchAll(DROPS)) {
    // `DROP TABLE x` (no IF EXISTS) fails when x is absent, so it also needs x to exist. The sort is\n    // stable, so a touch pushed before its drop at the same position is replayed first.
    const kind = match[1] ? "drop" : "touch";
    for (const raw of match[2].match(new RegExp(`${NAME}(?:\\s*\\.\\s*${NAME})?`, "gi")) ?? []) {
      add(match.index, kind, raw);
      if (kind === "touch") add(match.index, "drop", raw);
    }
  }
  for (const pattern of REFERENCES) {
    for (const match of statement.matchAll(pattern)) add(match.index, "touch", match[1]);
  }
  return events.sort((a, b) => a.at - b.at);
}

/**
 * Replays the chain statement by statement, tracking which tables exist.
 * An empty result means a fresh database can run the whole chain in order.
 * Pure: reads `files`, builds its own state, returns a new array.
 */
export function findUnresolvedTableRefs(files: readonly ChainFile[]): UnresolvedTableRef[] {
  const created = new Set<string>();
  const unresolved: UnresolvedTableRef[] = [];

  for (const file of files) {
    for (const chunk of file.sql.split(BREAKPOINT)) {
      const statement = stripComments(chunk);
      if (!statement.trim()) continue;
      const reported = new Set<string>();
      for (const event of eventsOf(statement)) {
        if (event.kind === "create") created.add(event.table);
        else if (event.kind === "drop") created.delete(event.table);
        else if (!created.has(event.table) && !reported.has(event.table)) {
          reported.add(event.table);
          unresolved.push({ tag: file.tag, table: event.table, statement: oneLine(statement) });
        }
      }
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

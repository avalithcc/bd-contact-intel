/**
 * The tables scripts/seed-launch-readiness.ts empties before it reseeds, and
 * how scripts/dev-setup.ts decides a database is safe to seed.
 *
 * One list feeds both the TRUNCATE and the emptiness check, so they cannot
 * drift apart: counting only `person` once let a database with data in the
 * other tables pass as "empty" and get wiped. `TRUNCATE ... CASCADE` also
 * empties every table with a foreign key (transitively) to these, so the check
 * covers those dependents too, read from the catalog rather than guessed.
 */

export const SEED_TRUNCATED_TABLES = [
  "activity",
  "task",
  "person_property_history",
  "person_bd_connection",
  "person_id_map",
  "audit_log",
  "person",
  "company",
] as const;

/** The statement the seed runs. Names are constants, never user input. */
export function truncateStatement(): string {
  return `truncate table ${SEED_TRUNCATED_TABLES.join(", ")} restart identity cascade`;
}

/** Catalog query: the seed tables plus every table CASCADE would also empty. Column: name. */
export function cascadeTablesQuery(): string {
  const roots = SEED_TRUNCATED_TABLES.map((t) => `'${t}'`).join(", ");
  return (
    `with recursive dep(oid) as (` +
    `select c.oid from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname in (${roots}) ` +
    `union select con.conrelid from pg_constraint con join dep on con.confrelid = dep.oid where con.contype = 'f') ` +
    `select distinct oid::regclass::text as name from dep order by name`
  );
}

/** Seed tables missing from the catalog result (migrations not applied), which must abort the check. */
export function missingSeedTables(found: readonly string[]): string[] {
  return SEED_TRUNCATED_TABLES.filter((t) => !found.includes(t));
}

/** Alias of table number `i` in the occupancy query and in its result row. */
export function occupancyKey(i: number): string {
  return `t${i}`;
}

/** One row, one boolean per table: does it hold at least one row. `tables` come from cascadeTablesQuery. */
export function occupiedTablesQuery(tables: readonly string[]): string {
  return `select ${tables.map((t, i) => `exists(select 1 from ${t}) as ${occupancyKey(i)}`).join(", ")}`;
}

/** The tables of `occupiedTablesQuery`'s row that hold data. Empty = safe to seed. */
export function occupiedTables(tables: readonly string[], row: Record<string, unknown>): string[] {
  return tables.filter((_, i) => row[occupancyKey(i)] === true);
}

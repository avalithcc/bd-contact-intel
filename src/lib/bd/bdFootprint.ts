/**
 * The ONE definition of "what in this database points at a `bd` row", shared by the read-only report
 * (scripts/measure/bd-footprint.ts) and the safety gate of the deletion (scripts/delete-unused-bd.ts), so the
 * question a human asks and the question the writer enforces can never drift apart.
 *
 * The columns come from the catalog, not from a list in this file: a table added later is swept without
 * anyone remembering to add it. That matters here — the previous answer to "can the e2e account be removed?"
 * (openspec/BACKLOG.md, 2026-10-13) checked six tables by hand, before `sequence`, `follow_up_queue_item`
 * and `email_account` existed.
 *
 * READ FROM pg_constraint, NOT information_schema. The obvious query joins `table_constraints`,
 * `referential_constraints` and `constraint_column_usage` on `constraint_name`, and that is wrong twice over:
 *   - Postgres requires a constraint name to be unique per TABLE, not per schema, so two tables sharing an FK
 *     name cross-attach their `delete_rule`. A CASCADE column reported as SET NULL is exactly the error that
 *     deletes history, because the gate below treats SET NULL as harmless.
 *   - Those views only show objects the current role owns or holds a privilege on, so foreign keys can go
 *     missing with no error at all, and the sweep would quietly look complete.
 * `pg_constraint` has neither problem, pairs the columns exactly via `unnest(conkey, confkey)`, and carries
 * the rule in `confdeltype`.
 *
 * What makes a reference BLOCKING is derived from that rule, never hardcoded per table:
 *   - SET NULL  -> not blocking. The referencing row survives with a null pointer; nothing is lost.
 *   - CASCADE   -> blocking. Deleting the bd would delete those rows with it (audit history, connections).
 *   - anything else (NO ACTION / RESTRICT / SET DEFAULT) -> blocking; the delete would fail or surprise.
 * A count of zero never blocks, whatever the rule.
 *
 * NOT covered, and no query here can cover it: a bd id stored inside a `jsonb` column (audit metadata does
 * this), and a count suppressed by row-level security on the connecting role. Callers must not read "0
 * blocking references" as "no trace anywhere".
 */
import { sql } from "drizzle-orm";

export interface BdReference {
  /** Schema-qualified and quoted as the server renders it, e.g. `person` or `"weird name"`. */
  table: string;
  column: string;
  /** Normalised ON DELETE rule: 'SET NULL' | 'CASCADE' | 'RESTRICT' | 'NO ACTION' | 'SET DEFAULT'. */
  deleteRule: string;
  rows: number;
}

/** `pg_constraint.confdeltype` codes. An unknown code maps to a name that `isBlockingReference` blocks on. */
export function deleteRuleFromCode(code: string): string {
  switch (code) {
    case "n":
      return "SET NULL";
    case "c":
      return "CASCADE";
    case "r":
      return "RESTRICT";
    case "d":
      return "SET DEFAULT";
    case "a":
      return "NO ACTION";
    default:
      return `UNKNOWN (${code})`;
  }
}

/** A reference only stops a deletion when rows exist AND losing or keeping them is not harmless. */
export function isBlockingReference(reference: BdReference): boolean {
  if (reference.rows === 0) return false;
  return reference.deleteRule.toUpperCase() !== "SET NULL";
}

export function blockingReferences(references: readonly BdReference[]): BdReference[] {
  return references.filter(isBlockingReference);
}

/**
 * Only what this module needs, so a `db.transaction` handle can be passed in as well as `db` itself. The
 * result is `unknown` and cast at each call site: drizzle's own `execute` returns a driver row list whose
 * generic does not unify across `db` and a transaction handle, and the repo casts those the same way
 * (see scripts/measure/review-duplicates.ts).
 */
export interface FootprintExecutor {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}

type CatalogRow = { table_ref: string; column_ref: string; delete_code: string };

/**
 * Every column with a foreign key to `public.bd(id)`, with its delete rule and how many rows hold `bdId`.
 * Sequential on purpose (see the GUARD SCOPE note in scripts/measure/README.md): one connection, no fan-out.
 *
 * Throws when a count comes back empty rather than treating it as zero: a missing count must not read as
 * "nothing references this BD".
 */
export async function readBdFootprint(executor: FootprintExecutor, bdId: string): Promise<BdReference[]> {
  // `conrelid::regclass` and `quote_ident` come back already quoted by the server, so the count below
  // interpolates an identifier the server itself produced and never one assembled here.
  const catalog = (await executor.execute(sql`
    select c.conrelid::regclass::text as table_ref,
           quote_ident(a.attname) as column_ref,
           c.confdeltype::text as delete_code
    from pg_constraint c
    join unnest(c.conkey, c.confkey) as k(attnum, fattnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    join pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = k.fattnum
    where c.contype = 'f'
      and c.confrelid = 'public.bd'::regclass
      and fa.attname = 'id'
    order by 1, 2
  `)) as unknown as CatalogRow[];

  const references: BdReference[] = [];
  for (const row of [...catalog]) {
    const counted = (await executor.execute(
      sql`select count(*)::int as n from ${sql.raw(row.table_ref)} where ${sql.raw(row.column_ref)} = ${bdId}::uuid`,
    )) as unknown as { n: number }[];
    const first = [...counted][0];
    if (first === undefined || first.n === null || first.n === undefined) {
      throw new Error(`footprint: no count returned for ${row.table_ref}.${row.column_ref} — refusing to read that as zero.`);
    }
    references.push({
      table: row.table_ref,
      column: row.column_ref,
      deleteRule: deleteRuleFromCode(row.delete_code),
      rows: Number(first.n),
    });
  }
  return references;
}

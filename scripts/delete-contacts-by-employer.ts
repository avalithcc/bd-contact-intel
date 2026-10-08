/**
 * Owner-directed deletion of contacts belonging to employers that are not
 * worth keeping (trade-show noise, "Particular", "Ninguna", a person's own
 * name used as a company). The employer list is an ARGUMENT, never a rule in
 * code: deciding that an employer is worthless is a judgement, not something
 * a script should infer.
 *
 * WHY A SCRIPT AND NOT A DELETE: every table referencing `person` cascades,
 * so a plain DELETE silently erases whatever a BD recorded. This refuses to
 * touch any contact that carries a footprint, using REFERENCING_TABLES — the
 * same canonical list scripts/delete-nameless-imported-contacts.ts uses, so
 * the set of "things that count as a footprint" exists once.
 *
 * Two references are deliberately NOT footprints:
 *   person_id_map       — import plumbing (every fi-arg contact has one).
 *   duplicate_candidate — a queue row, already resolved for these.
 * Everything else (activity, task, email_message, signal, follow-up queue,
 * linkedin_scrape_job, person_bd_connection, merge_event) blocks deletion,
 * and so does any person_property_history row whose source is not 'import'.
 *
 * `person_bd_connection` blocks on purpose: it records that a BD is connected
 * to this person on LinkedIn, and the cascade would destroy it. Re-inserting
 * the person row — which is the whole revert path — does NOT bring it back.
 *
 * ONE transaction under the identity lock. ONE audit_log row
 * ('delete_contacts_by_employer') holding the deleted ids AND the deleted
 * rows. REVERT: re-INSERT metadata.deletedPersons into `person` (same ids).
 *
 * Usage (dry run by default — never writes):
 *   npx tsx --env-file=.env.local scripts/delete-contacts-by-employer.ts --keys=<a,b,c>
 *   npx tsx --env-file=.env.local scripts/delete-contacts-by-employer.ts --keys=<a,b,c> --execute --actor=<bd id>
 */
import { inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, person } from "../src/db/schema";
import { REFERENCING_TABLES } from "../src/lib/contactosComerciales/revert";
import { withIdentityLock } from "../src/lib/identity/resolveDb";
import { isUuid } from "../src/lib/uuid";

export const DELETE_BY_EMPLOYER_ACTION = "delete_contacts_by_employer";
/** References that are import plumbing rather than a BD's work. */
const NOT_A_FOOTPRINT = new Set(["id_map", "duplicate_candidate"]);
const SCAN_CAP = 2_000;

function parseArgs(argv: readonly string[]) {
  let keys: string[] = [];
  let execute = false;
  let actor: string | null = null;
  for (const a of argv) {
    if (a === "--execute") execute = true;
    else if (a.startsWith("--actor=")) actor = a.slice("--actor=".length);
    else if (a.startsWith("--keys=")) keys = a.slice("--keys=".length).split(",").map((k) => k.trim()).filter(Boolean);
    else throw new Error(`Unknown argument: ${a}. Valid: --keys=<a,b,c>, --execute, --actor=<bd id>`);
  }
  if (!keys.length) throw new Error("Usage: --keys=<company_key,company_key,...> [--execute --actor=<bd id>]");
  if (execute && (!actor || !isUuid(actor))) throw new Error("--execute requires --actor=<bd uuid> for the audit row.");
  return { keys, execute, actor };
}

type Row = { id: string; name: string; emp: string | null; blockers: string };

async function read(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], keys: readonly string[]): Promise<Row[]> {
  const blocking = REFERENCING_TABLES.filter(([flag]) => !NOT_A_FOOTPRINT.has(flag));
  const flags = blocking.map(([flag, table, cols]) =>
    sql`(exists (select 1 from ${sql.raw(table)} r where ${sql.join(cols.map((c) => sql`r.${sql.raw(c)} = p.id`), sql` or `)}))::int as ${sql.raw(flag)}`);
  const rows = (await tx.execute(sql`
    select p.id::text as id, trim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')) as name, p.company as emp,
      ${sql.join(flags, sql`, `)},
      (exists (select 1 from person_property_history h where h.person_id = p.id and h.source <> 'import'))::int as edited
    from person p
    where p.merged_into_id is null and p.company_key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
    order by p.id
    limit ${SCAN_CAP + 1}`)) as unknown as (Record<string, unknown> & { id: string; name: string; emp: string | null })[];
  if (rows.length > SCAN_CAP) throw new Error(`More than ${SCAN_CAP} contacts match: over the cap, refusing.`);
  const names = [...blocking.map(([f]) => f as string), "edited"];
  return rows.map((r) => ({ id: r.id, name: r.name, emp: r.emp, blockers: names.filter((n) => Number(r[n]) === 1).join(",") }));
}

async function main() {
  const { keys, execute, actor } = parseArgs(process.argv.slice(2));
  const run = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    const all = await read(tx, keys);
    const deletable = all.filter((r) => !r.blockers);
    const blocked = all.filter((r) => r.blockers);
    console.log(`Matched contacts: ${all.length}`);
    console.log(`  deletable (no footprint): ${deletable.length}`);
    console.log(`  kept (a BD left something): ${blocked.length}`);
    for (const b of blocked) console.log(`    ${b.name || "(no name)"} — ${b.emp ?? "?"} — ${b.blockers}`);
    return { all, deletable };
  };

  if (!execute) {
    await db.transaction(async (tx) => { await tx.execute(sql`set transaction read only`); await run(tx); });
    console.log("\nNothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }

  const auditId = await db.transaction(async (tx) =>
    withIdentityLock(tx, async () => {
      const { deletable } = await run(tx);
      if (!deletable.length) return null;
      const ids = deletable.map((d) => d.id);
      // The revert path: these plain person rows go into the audit row.
      const snapshot = await tx.select().from(person).where(inArray(person.id, ids));
      const gone = await tx.delete(person).where(inArray(person.id, ids)).returning({ id: person.id });
      if (gone.length !== ids.length) throw new Error(`Expected to delete ${ids.length}, deleted ${gone.length}: aborting.`);
      const [row] = await tx.insert(auditLog).values({
        actorBdId: actor!,
        action: DELETE_BY_EMPLOYER_ACTION,
        metadata: { companyKeys: keys, deletedCount: ids.length, deletedPersonIds: ids, deletedPersons: snapshot },
      }).returning({ id: auditLog.id });
      return row!.id;
    }));
  console.log(auditId ? `\nDeleted. audit_log id: ${auditId} (revert: re-insert metadata.deletedPersons)` : "\nNothing to delete.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

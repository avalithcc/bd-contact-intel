/**
 * One-off backfill: normalize `person.phone` and `person.mobile_phone` to
 * E.164 (`+<digits>`), using normalizePhone (src/lib/phoneNormalize.ts) for
 * every decision. Rules, in the owner's terms: already-E.164 stays; `+` with
 * separators or a leading `00` is stripped to `+digits`; Argentine digits-only
 * numbers (source_key dff-2026, or person.country Argentina) get +549 / +54;
 * digits-only with an obvious country code and a valid length get a `+`.
 * Anything else is FLAGGED and left exactly as stored, never cleared.
 *
 * Scope: persons not merged away (`merged_into_id IS NULL`) with at least one
 * phone column set.
 *
 * Defaults to a DRY RUN: it only SELECTs, and prints per-rule counts, flagged
 * counts by reason and a masked sample of the flagged values (digits shown as
 * 9, letters as a: the shape, never a number or a name). The dry-run path
 * never opens a transaction and never calls an UPDATE or INSERT.
 *
 * `--execute --actor=<bd id>`: pages through the scope by keyset on `id`
 * (batches of BATCH_SIZE) and, inside ONE transaction, applies a bulk
 * UPDATE ... FROM (VALUES ...) per batch and column. Each update is guarded by
 * `column = old value`, so a number a BD edited since the read is skipped, not
 * overwritten. ONE `audit_log` row (action `normalize_person_phones`) records
 * the per-rule counts, the flagged counts, `previous` (old value) and `written`
 * (new value), both keyed by person id then column. `person.updated_at` is left alone (a format-only
 * rewrite is not an edit).
 *
 * Idempotent: a second run finds only already-E.164 values and writes nothing.
 *
 * Revert: restores the old value only where the column still holds the value
 * this run wrote (`written`), so a number a BD edited afterwards is never
 * overwritten. <audit id> is the audit_log row:
 *   with a as (select metadata->'previous' as prev, metadata->'written' as wrote from audit_log where id = '<audit id>')
 *   update person p set
 *     phone = case when a.prev->p.id::text ? 'phone' and p.phone = a.wrote->p.id::text->>'phone' then a.prev->p.id::text->>'phone' else p.phone end,
 *     mobile_phone = case when a.prev->p.id::text ? 'mobilePhone' and p.mobile_phone = a.wrote->p.id::text->>'mobilePhone' then a.prev->p.id::text->>'mobilePhone' else p.mobile_phone end
 *   from a where a.prev ? p.id::text;
 *
 * Usage (dry run is the default):
 *   npx tsx --env-file=.env.local scripts/normalize-phones.ts [--flagged-per-reason=<n>]
 *   npx tsx --env-file=.env.local scripts/normalize-phones.ts --execute --actor=<bd id>
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog } from "../src/db/schema";
import {
  newTally,
  planPhonePage,
  valuesByPerson,
  type PersonPhoneRow,
  type PhoneChange,
  type PhoneFlag,
  type PhoneTally,
} from "../src/lib/phoneNormalizeBackfill";

const BATCH_SIZE = 1000;
const AUDIT_ACTION = "normalize_person_phones";
const DEFAULT_FLAGGED_PER_REASON = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv: string[]) {
  let execute = false;
  let actor: string | null = null;
  let perReason = DEFAULT_FLAGGED_PER_REASON;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--actor=")) actor = arg.slice("--actor=".length);
    else if (arg.startsWith("--flagged-per-reason=")) perReason = Number(arg.slice("--flagged-per-reason=".length));
    else throw new Error(`Unknown argument: ${arg}. Valid: --execute, --actor=<bd id>, --flagged-per-reason=<n>`);
  }
  if (!Number.isInteger(perReason) || perReason < 0) throw new Error("--flagged-per-reason must be a non-negative integer");
  if (execute && !actor) throw new Error("--execute requires --actor=<bd id> for the audit log");
  return { execute, actor, perReason };
}

type Executor = Pick<typeof db, "execute">;

async function fetchPage(ex: Executor, lastId: string | null): Promise<PersonPhoneRow[]> {
  const rows = await ex.execute<{
    id: string;
    source_key: string | null;
    country: string | null;
    phone: string | null;
    mobile_phone: string | null;
  }>(sql`
    select id::text as id, source_key, country, phone, mobile_phone
    from person
    where merged_into_id is null
      and (phone is not null or mobile_phone is not null)
      and (${lastId}::uuid is null or id > ${lastId}::uuid)
    order by id
    limit ${BATCH_SIZE}
  `);
  return rows.map((r) => ({ id: r.id, sourceKey: r.source_key, country: r.country, phone: r.phone, mobilePhone: r.mobile_phone }));
}

interface ScanResult {
  tally: PhoneTally;
  planned: number;
  applied: PhoneChange[];
  flags: PhoneFlag[];
}

/** Walks the whole scope; `apply` gets each page's changes and returns the ones actually written. */
async function scan(ex: Executor, apply: (changes: PhoneChange[]) => Promise<PhoneChange[]>): Promise<ScanResult> {
  const tally = newTally();
  const applied: PhoneChange[] = [];
  const flags: PhoneFlag[] = [];
  let planned = 0;
  let lastId: string | null = null;
  for (;;) {
    const page = await fetchPage(ex, lastId);
    if (page.length === 0) break;
    const plan = planPhonePage(page, tally);
    planned += plan.changes.length;
    flags.push(...plan.flags);
    if (plan.changes.length > 0) applied.push(...(await apply(plan.changes)));
    lastId = page[page.length - 1].id;
  }
  return { tally, planned, applied, flags };
}

const COLUMN_SQL = { phone: sql`phone`, mobilePhone: sql`mobile_phone` } as const;

/** One bulk UPDATE per column, guarded by the old value; returns the changes that matched. */
async function writeBatch(tx: Executor, changes: PhoneChange[]): Promise<PhoneChange[]> {
  const written: PhoneChange[] = [];
  for (const column of ["phone", "mobilePhone"] as const) {
    const mine = changes.filter((c) => c.column === column);
    if (mine.length === 0) continue;
    const tuples = sql.join(mine.map((c) => sql`(${c.id}::uuid, ${c.oldValue}::text, ${c.newValue}::text)`), sql`, `);
    const col = COLUMN_SQL[column];
    const rows = await tx.execute<{ id: string }>(sql`
      update person p
      set ${col} = v.new_value
      from (values ${tuples}) as v(id, old_value, new_value)
      where p.id = v.id and p.${col} = v.old_value
      returning p.id::text as id
    `);
    const hit = new Set(rows.map((r) => r.id));
    written.push(...mine.filter((c) => hit.has(c.id)));
  }
  return written;
}

function printCounts(label: string, counts: Record<string, number>) {
  console.log(`${label}:`);
  const entries = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) console.log("  (none)");
  for (const [key, n] of entries) console.log(`  ${String(n).padStart(6)}  ${key}`);
}

function print(label: string, result: ScanResult, perReason: number) {
  console.log(`\n=== ${label}: ${result.tally.scanned} persons scanned, ${result.planned} value(s) ${label === "EXECUTED" ? "planned" : "would change"} ===`);
  printCounts("Accepted by rule (already_e164 is left as stored)", result.tally.rules);
  printCounts("Flagged by reason (left untouched)", result.tally.flagged);
  console.log(`\nFlagged sample, up to ${perReason} per column and reason (person id, column, reason, shape):`);
  const shown: Record<string, number> = {};
  for (const f of result.flags) {
    const key = `${f.column}:${f.reason}`;
    shown[key] = (shown[key] ?? 0) + 1;
    if (shown[key] <= perReason) console.log(`  ${f.id}  ${f.column}  ${f.reason}  ${f.masked}`);
  }
}

async function main() {
  const { execute, actor, perReason } = parseArgs(process.argv.slice(2));

  if (!execute) {
    const result = await scan(db, async () => []);
    print("DRY RUN", result, perReason);
    console.log("\nDry run: nothing written. Re-run with --execute --actor=<bd id> to apply.");
    return;
  }

  if (!UUID_RE.test(actor!)) throw new Error("--actor must be a bd uuid");
  const [actorRow] = await db.execute<{ id: string }>(sql`select id::text as id from bd where id = ${actor}::uuid`);
  if (!actorRow) throw new Error(`--actor ${actor} is not a bd row; nothing was scanned or written`);

  const result = await db.transaction(async (tx) => {
    const r = await scan(tx, (changes) => writeBatch(tx, changes));
    if (r.applied.length > 0) {
      await tx.insert(auditLog).values({
        actorBdId: actor!,
        action: AUDIT_ACTION,
        metadata: {
          scanned: r.tally.scanned,
          planned: r.planned,
          updated: r.applied.length,
          byRule: r.tally.rules,
          flagged: r.tally.flagged,
          previous: valuesByPerson(r.applied, "oldValue"),
          written: valuesByPerson(r.applied, "newValue"),
        },
      });
    }
    return r;
  });
  print("EXECUTED", result, perReason);
  console.log(result.applied.length > 0 ? `\nUpdated ${result.applied.length} value(s) and wrote 1 audit_log row.` : "\nNothing to update.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

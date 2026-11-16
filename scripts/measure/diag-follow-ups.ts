// Read-only diagnosis. In a read-only transaction Postgres raises column/parse
// errors (42703) at analyze time, BEFORE the read-only violation (25006) at
// execution, so running the INSERT here safely proves whether its SQL resolves
// without ever writing a row.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  buildFollowUpInsertQuery,
  buildFollowUpVerificationQuery,
  buildFollowUpRoleGroupCountsQuery,
} from "@/lib/followUp/candidateQuery";

const BD = "10df191b-269d-4ed1-8035-2550b0a1c047";
const TODAY = "2026-11-16";

async function probe(label: string, q: ReturnType<typeof sql>) {
  try {
    await db.execute(q);
    console.log(`${label}: OK (resolved and executed)`);
  } catch (e) {
    const err = e as { code?: string; message?: string; position?: string };
    if (err.code === "25006") console.log(`${label}: SQL RESOLVES (blocked only by read-only txn)`);
    else console.log(`${label}: *** ${err.code} *** ${err.message}${err.position ? ` @pos ${err.position}` : ""}`);
  }
}

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  await probe("counts     ", buildFollowUpRoleGroupCountsQuery(BD));
  await probe("verification", buildFollowUpVerificationQuery());
  await probe("insert     ", buildFollowUpInsertQuery(BD, TODAY));
  process.exit(0);
}
void main();

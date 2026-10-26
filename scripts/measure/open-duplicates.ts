// Read-only: the open duplicate queue, with the full detail of each candidate,
// using the admin screen's own queries (listOpenDuplicateCandidates /
// getDuplicateCandidateDetail). No hand-written SQL, no guessed columns.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  listOpenDuplicateCandidates,
  getDuplicateCandidateDetail,
} from "@/lib/identity/duplicateReviewQueries";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const guard = await db.execute(sql`show transaction_read_only`);
  console.log(`read_only: ${JSON.stringify(guard[0] ?? guard)}\n`);

  const page = await listOpenDuplicateCandidates(1);
  console.log(`abiertos: ${JSON.stringify({ total: (page as { total?: number }).total ?? "?" })}`);
  const rows = (page as { rows?: unknown[] }).rows ?? [];
  console.log(`filas en la pagina: ${rows.length}\n`);

  for (const r of rows as Array<{ id: string }>) {
    const detail = await getDuplicateCandidateDetail(r.id);
    console.log(`==== candidate ${r.id} ====`);
    console.log(JSON.stringify(detail, null, 2));
  }
  process.exit(0);
}

void main();

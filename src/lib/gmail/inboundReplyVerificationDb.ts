/**
 * DB glue for inboundReplyVerification.ts (imports `@/db`, so not unit-tested directly; the
 * decision lives in the pure planner). Shared by the Gmail sync (inside its transaction) and
 * scripts/backfill-inbound-reply-verified.ts.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import { person, personPropertyHistory } from "@/db/schema";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";
import { planInboundReplyBatch, type InboundReplyPromotion, type ReplyVerifiablePerson } from "./inboundReplyVerification";

export type ReplyTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Persons that could still be promoted: one bounded read by id, already-verified rows filtered out in SQL. */
export async function readPromotablePersons(tx: ReplyTx, personIds: readonly string[]): Promise<ReplyVerifiablePerson[]> {
  if (personIds.length === 0) return [];
  const out: ReplyVerifiablePerson[] = [];
  for (const part of chunk([...new Set(personIds)], WRITE_BATCH_SIZE)) {
    out.push(
      ...(await tx
        .select({
          id: person.id,
          emailNormalized: person.emailNormalized,
          emailStatus: person.emailStatus,
          mergedIntoId: person.mergedIntoId,
          // Literal "person." on purpose: drizzle may drop the table prefix, and an unqualified
          // column inside the subquery would resolve to q and count every live row.
          liveHolders: sql<string>`(select count(*) from person q where q.email_normalized = person.email_normalized and q.merged_into_id is null)`,
        })
        .from(person)
        .where(and(inArray(person.id, part), sql`${person.emailStatus} <> 'verified'`))
        .then((rows) => rows.map((r) => ({ ...r, liveHolders: Number(r.liveHolders) })))),
    );
  }
  return out;
}

/**
 * Writes the promotions. Grouped by the old status so each UPDATE is guarded by it, AND by the
 * address the reply came from: an email edit that lands between our read and this write can leave
 * the status at 'none' (none -> none), and the status guard alone would then verify an address
 * nobody replied from. A row that fails either guard drops out of RETURNING, and history is
 * written only for rows that actually changed. At most two UPDATEs (probable, none) per chunk.
 */
export async function applyReplyVerification(tx: ReplyTx, promotions: readonly InboundReplyPromotion[]): Promise<string[]> {
  const changed: string[] = [];
  for (const oldStatus of ["probable", "none"]) {
    const group = promotions.filter((r) => r.historyRow.oldValue === oldStatus);
    for (const part of chunk(group, WRITE_BATCH_SIZE)) {
      const pairs = sql.join(part.map((r) => sql`(${r.historyRow.personId}::uuid, ${r.address})`), sql`, `);
      const updated = await tx
        .update(person)
        .set({ emailStatus: "verified", updatedAt: new Date() })
        .where(and(sql`(${person.id}, ${person.emailNormalized}) in (${pairs})`, eq(person.emailStatus, oldStatus)))
        .returning({ id: person.id });
      const ids = new Set(updated.map((u) => u.id));
      const history = part.filter((r) => ids.has(r.historyRow.personId)).map((r) => r.historyRow);
      if (history.length > 0) await tx.insert(personPropertyHistory).values(history);
      changed.push(...ids);
    }
  }
  return changed;
}

/** Sync entry point: read, plan, write. */
export async function verifyRepliedAddressesInTx(tx: ReplyTx, candidates: readonly { personId: string; fromAddress: string }[]): Promise<void> {
  const persons = await readPromotablePersons(tx, candidates.map((c) => c.personId));
  const byId = new Map(persons.map((p) => [p.id, p]));
  const entries = candidates.flatMap((c) => {
    const p = byId.get(c.personId);
    return p ? [{ person: p, message: { direction: "inbound" as const, fromAddress: c.fromAddress } }] : [];
  });
  await applyReplyVerification(tx, planInboundReplyBatch(entries));
}

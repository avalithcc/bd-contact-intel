/**
 * The dedicated Sequence that holds every automatically discovered contact of ONE BD, so the owner can tell from the Sequences list
 * which messages came from a discovery and which a BD wrote by hand.
 *
 * Created through `createSequenceRow` (the same path the "Nueva secuencia" screen uses), so the mailbox, cap validation and schedule
 * are Sequences' own: the BD's single connected `email_account`, the default schedule, and the same daily send cap the discovery path
 * uses for drafts (AUTO_PROSPECTING_DAILY_CAP). Found by owner + name prefix, so renaming the BD never creates a second one.
 */
import { sql } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { emailAccount } from "@/db/schema";
import { createSequenceRow } from "@/lib/sequences/rosterQueries";
import { AUTO_PROSPECTING_DAILY_CAP } from "@/lib/prospecting/plan";
import { AUTO_SEQUENCE_PREFIX, autoSequenceName } from "@/lib/prospecting/autoSequenceName";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export { AUTO_SEQUENCE_PREFIX, autoSequenceName, isAutoSequenceName } from "@/lib/prospecting/autoSequenceName";

/** The BD's dedicated Sequence id, created on first use. Null when the BD has no connected mailbox (the caller defers). Serialized per BD. */
export async function ensureAutoSequence(tx: Tx, bdId: string, bdName: string): Promise<string | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`auto-sequence:${bdId}`}))`);
  const found = await tx.execute<{ id: string }>(sql`
    select id::text as id from sequence where owner_bd_id = ${bdId}::uuid and name like ${`${AUTO_SEQUENCE_PREFIX}%`} order by created_at, id limit 1
  `);
  const existing = Array.from(found)[0];
  if (existing) return existing.id;
  const [account] = await tx.select({ id: emailAccount.id }).from(emailAccount).where(and(eq(emailAccount.bdId, bdId), eq(emailAccount.status, "connected")));
  if (!account) return null;
  const created = await createSequenceRow(bdId, { name: autoSequenceName(bdName), emailAccountId: account.id, dailySendCap: AUTO_PROSPECTING_DAILY_CAP }, tx);
  if (!created.ok) throw new Error(`auto sequence for ${bdId} could not be created: ${created.error}`);
  return created.sequenceId;
}

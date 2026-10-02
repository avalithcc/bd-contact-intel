/**
 * Shared runner behind scripts/backfill-rfc-message-ids.ts and the admin page
 * /admin/rfc-backfill. Fills `email_message.rfc_message_id` / `rfc_references`
 * for messages synced before migration 0036 (see rfcBackfill.ts for the pure
 * planner). The Gmail token key only exists in production, so the admin page
 * is the vehicle that can actually run it there.
 *
 * Revert: take the ids from the audit row's metadata.updatedIds and run
 *   UPDATE email_message SET rfc_message_id = NULL, rfc_references = NULL
 *   WHERE id = ANY(<those ids>::uuid[]);
 * (safe: only rows that were NULL are ever filled.)
 */
import { desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, bd, emailAccount, emailMessage } from "@/db/schema";
import { decryptToken } from "./crypto";
import { refreshGmailAccessToken } from "./accessToken";
import { createGmailClient } from "./client";
import { parseGmailMessage, type ParsedGmailMessage } from "./parseMessage";
import {
  backfillKey,
  groupCandidatesByBd,
  planRfcBackfill,
  tallySkipReasons,
  type BackfillCandidate,
  type BackfillPlan,
  type BdSkipReason,
} from "./rfcBackfill";

export const BACKFILL_AUDIT_ACTION = "backfill_rfc_message_ids";
const BATCH = 200;

export interface PendingRfcBackfill {
  total: number;
  perBd: { bdId: string; name: string; email: string; pending: number }[];
}

/** Read-only: messages still without a Message-ID, in total and per BD. One query, no Gmail call. */
export async function countPendingRfcBackfill(): Promise<PendingRfcBackfill> {
  const rows = await db
    .select({
      bdId: emailMessage.bdId,
      name: bd.name,
      email: bd.email,
      pending: sql<number>`count(*)::int`,
    })
    .from(emailMessage)
    .innerJoin(bd, eq(bd.id, emailMessage.bdId))
    .where(isNull(emailMessage.rfcMessageId))
    .groupBy(emailMessage.bdId, bd.name, bd.email)
    .orderBy(desc(sql`count(*)`));
  const perBd = rows.map((r) => ({ ...r, pending: Number(r.pending) }));
  return { total: perBd.reduce((sum, r) => sum + r.pending, 0), perBd };
}

/** Newest-first candidates still lacking a Message-ID (one query). */
export async function selectRfcBackfillCandidates(limit: number): Promise<BackfillCandidate[]> {
  return db
    .select({ id: emailMessage.id, bdId: emailMessage.bdId, gmailMessageId: emailMessage.gmailMessageId })
    .from(emailMessage)
    .where(isNull(emailMessage.rfcMessageId))
    .orderBy(desc(emailMessage.sentAt))
    .limit(limit);
}

export interface RfcBackfillResult {
  counts: BackfillPlan["counts"];
  skippedBds: number;
  skipReasons: Record<BdSkipReason, number>;
  updated: number;
}

type BdFetch = { ok: true; fetched: Map<string, ParsedGmailMessage> } | { ok: false; reason: BdSkipReason };

/**
 * One BD's token decrypt + refresh + Gmail reads. Any failure (including an
 * AES-GCM auth failure from decryptToken) becomes a coarse skip reason so one
 * broken account cannot abort the other BDs; nothing from the error is kept.
 * A BD is all-or-nothing: a partial fetch is discarded and retried next run.
 */
async function fetchForBd(bdId: string, rows: readonly BackfillCandidate[]): Promise<BdFetch> {
  let stage: BdSkipReason = "token_refresh_failed";
  try {
    const [account] = await db.select().from(emailAccount).where(eq(emailAccount.bdId, bdId));
    if (!account || account.status !== "connected" || !account.refreshTokenEncrypted) {
      return { ok: false, reason: "no_account" };
    }
    const token = await refreshGmailAccessToken(decryptToken(account.refreshTokenEncrypted));
    if (!token.ok) return { ok: false, reason: "token_refresh_failed" };
    stage = "fetch_failed";
    const client = createGmailClient(token.accessToken);
    const fetched = new Map<string, ParsedGmailMessage>();
    for (const row of rows) {
      const message = await client.getMessage(row.gmailMessageId);
      if (message) fetched.set(backfillKey(row.bdId, row.gmailMessageId), parseGmailMessage(message));
    }
    return { ok: true, fetched };
  } catch {
    return { ok: false, reason: stage };
  }
}

/**
 * Fills up to `limit` rows (newest first) and writes them in ONE transaction,
 * batched, each update guarded by `rfc_message_id IS NULL`, together with ONE
 * audit_log row. Idempotent: filled rows no longer match the candidate query.
 */
export async function runRfcBackfill({ actorBdId, limit }: { actorBdId: string; limit: number }): Promise<RfcBackfillResult> {
  const candidates = await selectRfcBackfillCandidates(limit);
  const perBd = groupCandidatesByBd(candidates);

  const fetched = new Map<string, ParsedGmailMessage>();
  const skips: BdSkipReason[] = [];
  for (const [bdId, rows] of perBd) {
    const result = await fetchForBd(bdId, rows);
    if (result.ok) for (const [k, v] of result.fetched) fetched.set(k, v);
    else skips.push(result.reason);
  }

  const plan = planRfcBackfill(candidates, fetched);
  const skippedBds = skips.length;
  const skipReasons = tallySkipReasons(skips);
  if (plan.updates.length === 0) return { counts: plan.counts, skippedBds, skipReasons, updated: 0 };

  await db.transaction(async (tx) => {
    for (let i = 0; i < plan.updates.length; i += BATCH) {
      const chunk = plan.updates.slice(i, i + BATCH);
      const tuples = sql.join(
        chunk.map((u) => sql`(${u.id}::uuid, ${u.rfcMessageId}::text, ${u.rfcReferences}::text)`),
        sql`, `,
      );
      await tx.execute(sql`
        update email_message em
        set rfc_message_id = v.mid, rfc_references = v.refs
        from (values ${tuples}) as v(id, mid, refs)
        where em.id = v.id and em.rfc_message_id is null
      `);
    }
    await tx.insert(auditLog).values({
      actorBdId,
      action: BACKFILL_AUDIT_ACTION,
      metadata: { counts: plan.counts, skippedBds, updatedIds: plan.updates.map((u) => u.id) },
    });
  });
  return { counts: plan.counts, skippedBds, skipReasons, updated: plan.updates.length };
}

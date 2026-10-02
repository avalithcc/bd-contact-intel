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
import { parseGmailMessage } from "./parseMessage";
import type { BackfillCandidate } from "./rfcBackfill";
import { executeRfcBackfill, type RfcBackfillDeps, type RfcBackfillResult } from "./rfcBackfillCore";

export type { RfcBackfillResult };

export const BACKFILL_AUDIT_ACTION = "backfill_rfc_message_ids";

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

/**
 * Fills up to `limit` rows (newest first) and writes them in ONE transaction,
 * batched, each update guarded by `rfc_message_id IS NULL`, together with ONE
 * audit_log row. `updated` / `updatedIds` come from the rows the UPDATE
 * returned. Idempotent: filled rows no longer match the candidate query.
 */
export async function runRfcBackfill({ actorBdId, limit }: { actorBdId: string; limit: number }): Promise<RfcBackfillResult> {
  const deps: RfcBackfillDeps = {
    selectCandidates: selectRfcBackfillCandidates,
    loadAccount: async (bdId) => {
      const [account] = await db.select().from(emailAccount).where(eq(emailAccount.bdId, bdId));
      return account ? { connected: account.status === "connected", refreshTokenEncrypted: account.refreshTokenEncrypted } : null;
    },
    decryptToken,
    refreshAccessToken: async (refreshToken) => {
      const token = await refreshGmailAccessToken(refreshToken);
      return token.ok ? token : { ok: false, kind: token.classification.kind };
    },
    openMailbox: (accessToken) => {
      const client = createGmailClient(accessToken);
      return async (gmailMessageId) => {
        const message = await client.getMessage(gmailMessageId);
        return message ? parseGmailMessage(message) : null;
      };
    },
    writeUpdates: (batches, buildAuditMetadata) =>
      db.transaction(async (tx) => {
        const updatedIds: string[] = [];
        for (const chunk of batches) {
          const tuples = sql.join(
            chunk.map((u) => sql`(${u.id}::uuid, ${u.rfcMessageId}::text, ${u.rfcReferences}::text)`),
            sql`, `,
          );
          const rows = await tx.execute<{ id: string }>(sql`
            update email_message em
            set rfc_message_id = v.mid, rfc_references = v.refs
            from (values ${tuples}) as v(id, mid, refs)
            where em.id = v.id and em.rfc_message_id is null
            returning em.id::text as id
          `);
          for (const row of rows) updatedIds.push(row.id);
        }
        if (updatedIds.length > 0) {
          await tx.insert(auditLog).values({ actorBdId, action: BACKFILL_AUDIT_ACTION, metadata: buildAuditMetadata(updatedIds) });
        }
        return updatedIds;
      }),
    logError: (line) => console.error(line),
  };
  return executeRfcBackfill(deps, { limit });
}

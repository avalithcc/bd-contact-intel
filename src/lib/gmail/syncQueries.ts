/**
 * DB glue for /api/gmail/sync (email-sync brief, slice 3). Imports `@/db`
 * (side effects requiring DATABASE_URL) — same convention as
 * src/lib/status/recompute.ts — so this file is not unit-tested directly;
 * src/lib/gmail/syncAccount.ts carries the tested orchestration logic
 * against fakes shaped exactly like these functions' signatures.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, emailAccount, emailMessage, emailMessagePerson, person } from "@/db/schema";
import { needsReconnectForSync } from "./needsReconnectForSync";
import { getNeverLogRules } from "./neverLog";
import { recomputePersonStatuses } from "@/lib/status/recompute";
import { isOwnerTouchType } from "@/lib/identity/ownerOnTouch";
import { transferOwnersOnTouch } from "@/lib/identity/ownerOnTouchDb";
import { verifyRepliedAddressesInTx } from "./inboundReplyVerificationDb";
import { executeSyncedMessageWrite, type SyncWriteStore } from "./syncWriteCore";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";
import { buildAfterSyncSet, type AfterSyncPatch } from "./afterSyncPatch";
import type { ClassifiedMessage, KnownPersonEmail } from "./classify";
import type { OutboundThreadRef, ThreadRefQuery } from "./threadAttribution";

export { getNeverLogRules };

export interface SyncableAccount {
  bdId: string;
  bdEmail: string;
  refreshTokenEncrypted: string;
  historyId: string | null;
  backfillPageToken: string | null;
  // Only populated (and only needed) by getSyncableAccountForBd — the
  // manual "Sincronizar ahora" cooldown check (syncCooldown.ts). The cron
  // path (getSyncableAccounts) never reads this field.
  lastSyncedAt: Date | null;
}

function toSyncableAccount(r: {
  bdId: string;
  emailAddress: string;
  refreshTokenEncrypted: string;
  historyId: string | null;
  backfillPageToken: string | null;
  lastSyncedAt?: Date | null;
}): SyncableAccount {
  return {
    bdId: r.bdId,
    bdEmail: r.emailAddress,
    refreshTokenEncrypted: r.refreshTokenEncrypted,
    historyId: r.historyId,
    backfillPageToken: r.backfillPageToken,
    lastSyncedAt: r.lastSyncedAt ?? null,
  };
}

/** Connected accounts that hold the readonly scope this feature needs — a pre-readonly connection is skipped, not retried, until the BD reconnects. */
export async function getSyncableAccounts(): Promise<SyncableAccount[]> {
  const rows = await db
    .select({
      bdId: emailAccount.bdId,
      emailAddress: emailAccount.emailAddress,
      refreshTokenEncrypted: emailAccount.refreshTokenEncrypted,
      historyId: emailAccount.historyId,
      backfillPageToken: emailAccount.backfillPageToken,
      grantedScopes: emailAccount.grantedScopes,
    })
    .from(emailAccount)
    .where(eq(emailAccount.status, "connected"));

  return rows
    .filter((r): r is typeof r & { refreshTokenEncrypted: string } =>
      Boolean(r.refreshTokenEncrypted) && !needsReconnectForSync(r.grantedScopes),
    )
    .map(toSyncableAccount);
}

/**
 * Same eligibility rule as `getSyncableAccounts`, scoped to one BD — backs
 * the "Sincronizar ahora" button (email-sync.html:249): a BD can only ever
 * trigger their OWN account's sync, and only when it's actually eligible
 * (connected, readonly-scoped, has a refresh token) — the same guard the
 * cron already enforces, checked again here since a manual trigger is a
 * second, BD-initiated entry point into the same write path. Also returns
 * `lastSyncedAt` (fresh-review fix, 2026-10-01) so the caller can run the
 * server-side cooldown check (syncCooldown.ts) without a second round trip.
 */
export async function getSyncableAccountForBd(bdId: string): Promise<SyncableAccount | null> {
  const [row] = await db
    .select({
      bdId: emailAccount.bdId,
      emailAddress: emailAccount.emailAddress,
      refreshTokenEncrypted: emailAccount.refreshTokenEncrypted,
      historyId: emailAccount.historyId,
      backfillPageToken: emailAccount.backfillPageToken,
      grantedScopes: emailAccount.grantedScopes,
      lastSyncedAt: emailAccount.lastSyncedAt,
    })
    .from(emailAccount)
    .where(and(eq(emailAccount.bdId, bdId), eq(emailAccount.status, "connected")));

  if (!row || !row.refreshTokenEncrypted || needsReconnectForSync(row.grantedScopes)) return null;
  return toSyncableAccount({ ...row, refreshTokenEncrypted: row.refreshTokenEncrypted });
}

/** CRM persons matching any of `addresses` — bounded to exactly the addresses this sync run's messages mention, never the whole 26k-row table (PERFORMANCE.md). */
export async function getKnownPersonsForAddresses(addresses: string[]): Promise<KnownPersonEmail[]> {
  if (addresses.length === 0) return [];
  const rows = await db
    .select({ id: person.id, emailNormalized: person.emailNormalized, emailSource: person.emailSource })
    .from(person)
    .where(and(inArray(person.emailNormalized, addresses), isNull(person.mergedIntoId)));
  return rows
    .filter((r): r is typeof r & { emailNormalized: string } => r.emailNormalized !== null)
    .map((r) => ({
      personId: r.id,
      emailNormalized: r.emailNormalized,
      confidence: r.emailSource === "pattern_inferred" ? "inferred" : "exact",
    }));
}

/** gmailMessageIds already recorded as this BD's own `email_sent` activity (src/lib/gmail/send.ts) — dedup against platform-sent mail. */
export async function getPlatformSentGmailMessageIds(bdId: string, gmailMessageIds: string[]): Promise<Set<string>> {
  if (gmailMessageIds.length === 0) return new Set();
  const idList = sql.join(
    gmailMessageIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<{ gmail_message_id: string }>(sql`
    SELECT metadata->>'gmailMessageId' AS gmail_message_id
    FROM activity
    WHERE actor_bd_id = ${bdId}::uuid
      AND type = 'email_sent'
      AND metadata->>'gmailMessageId' IN (${idList})
  `);
  return new Set(rows.map((r) => r.gmail_message_id));
}

/** Every connected mailbox address (all BDs), lowercase: any of them writing in a thread is us, not a contact. One row per BD. */
export async function getOwnMailboxAddresses(): Promise<string[]> {
  const rows = await db.select({ address: emailAccount.emailAddress }).from(emailAccount).where(eq(emailAccount.status, "connected"));
  return rows.map((r) => r.address.trim().toLowerCase());
}

type OutboundRefRow = { thread_id: string; rfc_message_id: string | null; sent_at: Date | string; person_ids: string[]; matched_emails: string[] };

/**
 * Our outbound mail (with the persons it is attributed to) in the given threads, or carrying the
 * given Message-IDs. Not limited on purpose: truncating would hide a second contact and turn an
 * ambiguous thread into a confident wrong one. Bounded by the keys instead, in chunks.
 * The thread leg uses email_message_bd_thread_idx (bd_id, gmail_thread_id). There is NO index on
 * rfc_message_id, so the header leg scans this BD's rows; it runs only for replies whose thread
 * held none of our mail, once per batch (proposed index in the PR notes, not added here).
 */
export async function getOutboundThreadRefs(bdId: string, query: ThreadRefQuery): Promise<OutboundThreadRef[]> {
  const out: OutboundThreadRef[] = [];
  const legs: [string, string[]][] = [
    ["em.gmail_thread_id", query.threadIds],
    ["em.rfc_message_id", query.rfcMessageIds],
  ];
  for (const [column, keys] of legs) {
    for (const part of chunk(keys, WRITE_BATCH_SIZE)) {
      const list = sql.join(part.map((k) => sql`${k}`), sql`, `);
      const rows = await db.execute<OutboundRefRow>(sql`
        select em.gmail_thread_id as thread_id, em.rfc_message_id, em.sent_at, array_agg(distinct emp.person_id::text) as person_ids, array_agg(distinct emp.matched_email) as matched_emails
        from email_message em
        join email_message_person emp on emp.email_message_id = em.id
        where em.bd_id = ${bdId}::uuid and em.direction = 'outbound' and ${sql.raw(column)} in (${list})
        group by em.id
      `);
      out.push(...rows.map((r) => ({ gmailThreadId: r.thread_id, rfcMessageId: r.rfc_message_id, sentAt: new Date(r.sent_at), personIds: r.person_ids, matchedEmails: r.matched_emails })));
    }
  }
  return out;
}

export async function updateAccountAfterSync(
  bdId: string,
  patch: AfterSyncPatch,
): Promise<void> {
  await db
    .update(emailAccount)
    .set(buildAfterSyncSet(patch, new Date()))
    .where(eq(emailAccount.bdId, bdId));
}

export interface WriteSyncedMessagesResult {
  inserted: number;
}

/**
 * Idempotent write for one BD's classified batch, all in one transaction:
 * upsert `email_message` + `email_message_person`, then — per fresh-review
 * design change, 2026-09-30 — exactly ONE `activity` row per matched person
 * for every message actually inserted this run (see
 * src/lib/gmail/buildSyncedActivities.ts for the full rationale and the
 * `reply_received`/`email_sent` mapping). A platform-sent outbound message
 * gets no new activity — it already has one from src/lib/gmail/send.ts — we
 * only backfill a `gmailMessageId` link onto it. Idempotency for everything
 * here comes from `email_message`'s own `unique(bd_id, gmail_message_id)`
 * (`ON CONFLICT DO NOTHING`): a message is only ever inserted once, so its
 * activity/join rows are only ever written once, on that same run.
 */
export async function writeSyncedMessages(
  bdId: string,
  classified: readonly ClassifiedMessage[],
): Promise<WriteSyncedMessagesResult> {
  if (classified.length === 0) return { inserted: 0 };
  return db.transaction((tx) => executeSyncedMessageWrite(txSyncStore(tx), bdId, classified));
}

type SyncTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function txSyncStore(tx: SyncTransaction): SyncWriteStore {
  return {
    insertMessages: (rows) =>
      tx.insert(emailMessage).values(rows).onConflictDoNothing().returning({
        id: emailMessage.id,
        gmailMessageId: emailMessage.gmailMessageId,
        gmailThreadId: emailMessage.gmailThreadId,
        direction: emailMessage.direction,
        sentAt: emailMessage.sentAt,
      }),
    async fillRfcIds(bdId, fills) {
      let changed = 0;
      for (const part of chunk(fills, WRITE_BATCH_SIZE)) {
        const tuples = sql.join(
          part.map((f) => sql`(${f.gmailMessageId}::text, ${f.rfcMessageId}::text, ${f.rfcReferences}::text)`),
          sql`, `,
        );
        const rows = await tx.execute<{ id: string }>(sql`
          update email_message em
          set rfc_message_id = v.mid, rfc_references = v.refs
          from (values ${tuples}) as v(gid, mid, refs)
          where em.bd_id = ${bdId}::uuid and em.gmail_message_id = v.gid and em.rfc_message_id is null
          returning em.id::text as id
        `);
        changed += rows.length;
      }
      return changed;
    },
    async insertPersonLinks(rows) {
      await tx.insert(emailMessagePerson).values(rows).onConflictDoNothing();
    },
    async linkPlatformActivity(bdId, row) {
      await tx
        .update(activity)
        .set({ metadata: sql`${activity.metadata} || jsonb_build_object('emailMessageId', ${row.id}::text)` })
        .where(
          and(
            eq(activity.actorBdId, bdId),
            eq(activity.type, "email_sent"),
            sql`${activity.metadata}->>'gmailMessageId' = ${row.gmailMessageId}`,
          ),
        );
    },
    async insertActivities(bdId, rows) {
      const inserted = await tx
        .insert(activity)
        .values(rows.map((r) => ({ personId: r.personId, type: r.type, actorBdId: bdId, metadata: r.metadata })))
        .returning({ personId: activity.personId });
      await recomputePersonStatuses(tx, inserted.map((r) => r.personId!));
      await transferOwnersOnTouch(
        tx,
        rows.filter((r) => r.personId && isOwnerTouchType(r.type)).map((r) => r.personId!),
        bdId,
      );
    },
    verifyRepliedAddresses: (candidates) => verifyRepliedAddressesInTx(tx, candidates),
  };
}

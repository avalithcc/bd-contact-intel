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
import { buildSyncedActivityRows } from "./buildSyncedActivities";
import { buildAfterSyncSet, type AfterSyncPatch } from "./afterSyncPatch";
import type { ClassifiedMessage, KnownPersonEmail, NeverLogRule } from "./classify";

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

  return db.transaction(async (tx) => {
    const values = classified.map((c) => ({
      bdId,
      gmailMessageId: c.gmailMessageId,
      gmailThreadId: c.gmailThreadId,
      direction: c.direction,
      personId: c.matches[0]!.personId,
      fromAddress: c.fromAddress,
      toAddresses: c.toAddresses,
      ccAddresses: c.ccAddresses,
      subject: c.subject,
      bodyText: c.bodyText,
      bodyTruncated: c.bodyTruncated,
      sentAt: c.sentAt,
      matchedEmail: c.matches[0]!.matchedEmail,
      matchConfidence: c.matches[0]!.matchConfidence,
    }));

    const insertedRows = await tx
      .insert(emailMessage)
      .values(values)
      .onConflictDoNothing()
      .returning({
        id: emailMessage.id,
        gmailMessageId: emailMessage.gmailMessageId,
        gmailThreadId: emailMessage.gmailThreadId,
        direction: emailMessage.direction,
        sentAt: emailMessage.sentAt,
      });
    if (insertedRows.length === 0) return { inserted: 0 };

    const classifiedByGmailId = new Map(classified.map((c) => [c.gmailMessageId, c]));

    const joinRows = insertedRows.flatMap((row) =>
      classifiedByGmailId.get(row.gmailMessageId)!.matches.map((m) => ({
        emailMessageId: row.id,
        personId: m.personId,
        matchedEmail: m.matchedEmail,
        matchConfidence: m.matchConfidence,
      })),
    );
    await tx.insert(emailMessagePerson).values(joinRows).onConflictDoNothing();

    // Backfill: link a pre-existing platform `email_sent` activity to the
    // email_message row now recorded for the same Gmail message, instead of
    // writing a second activity for it (see buildSyncedActivityRows).
    for (const row of insertedRows) {
      if (!classifiedByGmailId.get(row.gmailMessageId)!.isPlatformSent) continue;
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
    }

    const activityRows = insertedRows.flatMap((row) => {
      const c = classifiedByGmailId.get(row.gmailMessageId)!;
      return buildSyncedActivityRows({
        gmailMessageId: row.gmailMessageId,
        gmailThreadId: row.gmailThreadId,
        direction: c.direction,
        fromAddress: c.fromAddress,
        toAddresses: c.toAddresses,
        subject: c.subject,
        sentAt: row.sentAt,
        isPlatformSent: c.isPlatformSent,
        matches: c.matches,
      });
    });

    if (activityRows.length > 0) {
      const insertedActivities = await tx
        .insert(activity)
        .values(activityRows.map((r) => ({ personId: r.personId, type: r.type, actorBdId: bdId, metadata: r.metadata })))
        .returning({ personId: activity.personId });
      await recomputePersonStatuses(
        tx,
        insertedActivities.map((r) => r.personId!),
      );
    }

    return { inserted: insertedRows.length };
  });
}

/**
 * Orchestration of the sync's write (`writeSyncedMessages`) against a store
 * port, so the ordering and idempotency are unit-tested with a fake that
 * models the unique key; syncQueries.ts wires the real transaction.
 *
 * Message-ID fill-in: a message the send path stored with a null
 * `rfc_message_id` (its read-back failed) is completed here by a SEPARATE
 * NULL-guarded UPDATE keyed on (bd_id, gmail_message_id). It is deliberately
 * not `ON CONFLICT DO UPDATE`: that would make the insert RETURN the row, and
 * the link rows, the `email_sent` activity and the pointer backfill below are
 * all driven off the returned rows — the sync would then write a duplicate
 * activity and duplicate links for a message the send path already recorded.
 * The fill touches two columns and nothing else, and runs before the
 * early return so it also covers the batch where every insert conflicted.
 */
import type { NewEmailMessage, NewEmailMessagePerson } from "@/db/schema";
import type { ClassifiedMessage } from "./classify";
import { buildEmailMessagePersonRows, buildEmailMessageRow } from "./emailMessageRows";
import { buildSyncedActivityRows, type SyncedActivityRow } from "./buildSyncedActivities";

export interface RfcFill {
  gmailMessageId: string;
  rfcMessageId: string;
  rfcReferences: string | null;
}

export interface InsertedMessageRow {
  id: string;
  gmailMessageId: string;
  gmailThreadId: string;
  direction: string;
  sentAt: Date;
}

export interface SyncWriteStore {
  /** INSERT ... ON CONFLICT DO NOTHING RETURNING: only rows actually inserted. */
  insertMessages(rows: NewEmailMessage[]): Promise<InsertedMessageRow[]>;
  /** UPDATE ... WHERE bd_id AND gmail_message_id AND rfc_message_id IS NULL; returns rows changed. */
  fillRfcIds(bdId: string, fills: RfcFill[]): Promise<number>;
  insertPersonLinks(rows: NewEmailMessagePerson[]): Promise<void>;
  /** Points a pre-existing platform `email_sent` activity at the stored row. */
  linkPlatformActivity(bdId: string, row: InsertedMessageRow): Promise<void>;
  /** Inserts activities and recomputes the touched persons' statuses. */
  insertActivities(bdId: string, rows: SyncedActivityRow[]): Promise<void>;
}

/** Messages that carry a Message-ID, one per gmail id. Pure; never mutates `classified`. */
export function planRfcFills(classified: readonly ClassifiedMessage[]): RfcFill[] {
  const byId = new Map<string, RfcFill>();
  for (const c of classified) {
    if (c.rfcMessageId === null || byId.has(c.gmailMessageId)) continue;
    byId.set(c.gmailMessageId, { gmailMessageId: c.gmailMessageId, rfcMessageId: c.rfcMessageId, rfcReferences: c.references });
  }
  return [...byId.values()];
}

export async function executeSyncedMessageWrite(
  store: SyncWriteStore,
  bdId: string,
  classified: readonly ClassifiedMessage[],
): Promise<{ inserted: number }> {
  if (classified.length === 0) return { inserted: 0 };

  const insertedRows = await store.insertMessages(classified.map((c) => buildEmailMessageRow(bdId, c)));

  const fills = planRfcFills(classified);
  if (fills.length > 0) await store.fillRfcIds(bdId, fills);

  if (insertedRows.length === 0) return { inserted: 0 };

  const classifiedByGmailId = new Map(classified.map((c) => [c.gmailMessageId, c]));

  await store.insertPersonLinks(
    insertedRows.flatMap((row) => buildEmailMessagePersonRows(row.id, classifiedByGmailId.get(row.gmailMessageId)!.matches)),
  );

  for (const row of insertedRows) {
    if (classifiedByGmailId.get(row.gmailMessageId)!.isPlatformSent) await store.linkPlatformActivity(bdId, row);
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
  if (activityRows.length > 0) await store.insertActivities(bdId, activityRows);

  return { inserted: insertedRows.length };
}

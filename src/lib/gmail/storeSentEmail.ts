/**
 * Conflict-safe write of a sent message's `email_message` + link rows,
 * against a small store port so the ordering/conflict logic is unit-tested
 * with a fake that models `unique(bd_id, gmail_message_id)`; the real port
 * (sentEmailQueries.ts) runs on the caller's transaction.
 *
 * Collision with the sync, both directions:
 *  - send first: the sync's `INSERT ... ON CONFLICT DO NOTHING` returns no
 *    row for that message, so it also writes no link rows, no activity, and
 *    skips the `metadata.emailMessageId` backfill (all keyed off inserted rows).
 *  - sync first (it landed between the Gmail send and this write): our insert
 *    conflicts, we write nothing and reuse the existing row's id.
 */
import type { NewEmailMessage, NewEmailMessagePerson } from "@/db/schema";
import type { ClassifiedMessage } from "./classify";
import { buildEmailMessagePersonRows, buildEmailMessageRow } from "./emailMessageRows";

export interface SentEmailStore {
  /** Inserts with ON CONFLICT DO NOTHING; the new id, or null when the row already existed. */
  insertMessage(row: NewEmailMessage): Promise<string | null>;
  findMessageId(bdId: string, gmailMessageId: string): Promise<string>;
  insertPersonLinks(rows: NewEmailMessagePerson[]): Promise<void>;
}

export interface StoredSentEmail {
  emailMessageId: string;
  /** False when a row for this message already existed (the sync won the race). */
  inserted: boolean;
}

/** Caller must have checked `shouldStoreClassifiedMessage(classified)`. */
export async function storeSentEmailMessage(
  store: SentEmailStore,
  bdId: string,
  classified: ClassifiedMessage,
): Promise<StoredSentEmail> {
  const insertedId = await store.insertMessage(buildEmailMessageRow(bdId, classified));
  if (insertedId === null) {
    return { emailMessageId: await store.findMessageId(bdId, classified.gmailMessageId), inserted: false };
  }
  await store.insertPersonLinks(buildEmailMessagePersonRows(insertedId, classified.matches));
  return { emailMessageId: insertedId, inserted: true };
}

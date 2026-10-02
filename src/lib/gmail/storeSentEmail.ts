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

/**
 * False only when the sync already stored this message (our insert conflicted,
 * so the key is the Gmail message id — a second send always has a new id and
 * is never suppressed) AND the sync's own `email_sent` activity covers this
 * activity's subject. The sync cannot know the message is platform-sent when
 * it lands between the Gmail send and our commit, so it writes one activity
 * per matched person; writing ours too would show the same email twice.
 *
 * Covered: an activity for a matched person, and an activity with no
 * `personId` (a lead/company-only caller — its person is resolved from the
 * lead, so it is the same email the sync just recorded). Not covered: an
 * activity for a person the sync did not match, which the sync never wrote.
 */
export function shouldWriteSentActivity(
  stored: StoredSentEmail,
  matches: readonly { personId: string }[],
  activityPersonId: string | null | undefined,
): boolean {
  if (stored.inserted) return true;
  if (!activityPersonId) return false;
  return !matches.some((m) => m.personId === activityPersonId);
}

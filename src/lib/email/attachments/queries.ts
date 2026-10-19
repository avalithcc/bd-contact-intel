/**
 * DB side of email attachments: bookkeeping only. The bytes live in Storage and are deleted right after the send; a row
 * records that an object exists (so the sweeper can find it) and, for a scheduled email, which files it holds.
 * Dates reach SQL only through DB-side `now()`, never as JS values.
 */
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailAttachment, scheduledEmail } from "@/db/schema";
import type { ValidatedAttachment } from "./load";

type Runner = Pick<typeof db, "insert" | "update" | "select">;

export interface AttachmentRow {
  id: string;
  bdId: string;
  ownerAuthUid: string;
  storagePath: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  scheduledEmailId: string | null;
}

/** Idempotent: registering the same upload twice keeps the first row. Returns the number of NEW rows. */
export async function registerAttachments(bdId: string, ownerAuthUid: string, items: readonly ValidatedAttachment[], run: Runner = db): Promise<number> {
  if (items.length === 0) return 0;
  const inserted = await run
    .insert(emailAttachment)
    .values(items.map((i) => ({ bdId, ownerAuthUid, storagePath: i.storagePath, filename: i.filename, contentType: i.contentType, sizeBytes: i.size })))
    .onConflictDoNothing({ target: emailAttachment.storagePath })
    .returning({ id: emailAttachment.id });
  return inserted.length;
}

/** Of these paths, the ones a live (not removed) row still tracks. */
export async function trackedPaths(paths: readonly string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const rows = await db
    .select({ storagePath: emailAttachment.storagePath })
    .from(emailAttachment)
    .where(and(inArray(emailAttachment.storagePath, [...paths]), isNull(emailAttachment.removedAt)));
  return new Set(rows.map((r) => r.storagePath));
}

/** Whether a tracked, still-stored file is held by a scheduled email (a held file must not be deleted by the composer). */
export async function isHeldByScheduledEmail(storagePath: string): Promise<boolean> {
  const [row] = await db
    .select({ scheduledEmailId: emailAttachment.scheduledEmailId })
    .from(emailAttachment)
    .where(and(eq(emailAttachment.storagePath, storagePath), isNull(emailAttachment.removedAt)));
  return Boolean(row?.scheduledEmailId);
}

/** The object is gone from Storage (or was never there): stop tracking it. */
export async function markAttachmentsRemoved(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  await db.update(emailAttachment).set({ removedAt: sql`now()` }).where(and(inArray(emailAttachment.storagePath, [...paths]), isNull(emailAttachment.removedAt)));
}

/**
 * Makes `items` exactly the files of this scheduled email (the caller already holds the BD's per-user lock inside `tx`):
 * new ones are registered and linked, files no longer wanted are unlinked and become orphans for the sweeper.
 */
export async function setScheduledAttachments(tx: Runner, scheduledId: string, bdId: string, ownerAuthUid: string, items: readonly ValidatedAttachment[]): Promise<void> {
  await registerAttachments(bdId, ownerAuthUid, items, tx);
  const keep = items.map((i) => i.storagePath);
  await tx
    .update(emailAttachment)
    .set({ scheduledEmailId: null })
    .where(and(eq(emailAttachment.scheduledEmailId, scheduledId), keep.length ? notInArray(emailAttachment.storagePath, keep) : sql`true`));
  if (keep.length) {
    // The order the BD attached them in (the uploads finish in any order).
    const order = sql`(case ${emailAttachment.storagePath} ${sql.join(items.map((i, index) => sql`when ${i.storagePath} then ${index}::smallint`), sql` `)} else 0::smallint end)`;
    await tx
      .update(emailAttachment)
      .set({ scheduledEmailId: scheduledId, position: order })
      // Only a free file, or one this email already holds: a path that belongs to ANOTHER scheduled email is never taken over.
      .where(
        and(
          inArray(emailAttachment.storagePath, keep),
          eq(emailAttachment.bdId, bdId),
          isNull(emailAttachment.removedAt),
          or(isNull(emailAttachment.scheduledEmailId), eq(emailAttachment.scheduledEmailId, scheduledId)),
        ),
      );
  }
}

/** Files held by these scheduled emails, in upload order (the order they were attached). */
export async function listScheduledAttachments(scheduledIds: readonly string[]): Promise<AttachmentRow[]> {
  if (scheduledIds.length === 0) return [];
  return db
    .select({
      id: emailAttachment.id,
      bdId: emailAttachment.bdId,
      ownerAuthUid: emailAttachment.ownerAuthUid,
      storagePath: emailAttachment.storagePath,
      filename: emailAttachment.filename,
      contentType: emailAttachment.contentType,
      sizeBytes: emailAttachment.sizeBytes,
      scheduledEmailId: emailAttachment.scheduledEmailId,
    })
    .from(emailAttachment)
    .where(and(inArray(emailAttachment.scheduledEmailId, [...scheduledIds]), isNull(emailAttachment.removedAt)))
    .orderBy(asc(emailAttachment.position), asc(emailAttachment.createdAt), asc(emailAttachment.id));
}

export interface SweepCandidate {
  storagePath: string;
}

export const ORPHAN_AFTER_HOURS = 24;
export const CANCELLED_KEEP_DAYS = 30;

/**
 * Objects that must not stay in Storage:
 *  - an upload nothing claimed (no scheduled email) for more than 24 h: abandoned composer, or a failed post-send delete;
 *  - a file of a scheduled email that was cancelled more than 30 days ago;
 *  - a file of a scheduled email that was sent (its delete after dispatch failed).
 * Failed, scheduled, held and in-flight rows keep their files. Bounded by `limit`.
 */
export async function selectSweepable(limit: number): Promise<SweepCandidate[]> {
  return db
    .select({ storagePath: emailAttachment.storagePath })
    .from(emailAttachment)
    .where(
      and(
        isNull(emailAttachment.removedAt),
        sql`(
          (${emailAttachment.scheduledEmailId} is null and ${emailAttachment.createdAt} < now() - make_interval(hours => ${ORPHAN_AFTER_HOURS}))
          or exists (
            select 1 from ${scheduledEmail} s
            where s.id = ${emailAttachment.scheduledEmailId}
              and (s.status = 'sent' or (s.status = 'cancelled' and s.updated_at < now() - make_interval(days => ${CANCELLED_KEEP_DAYS})))
          )
        )`,
      ),
    )
    .orderBy(asc(emailAttachment.createdAt))
    .limit(limit);
}

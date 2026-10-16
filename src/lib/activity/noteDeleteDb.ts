import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity } from "@/db/schema";
import { canDeleteNote, NoteDeleteForbiddenError, NoteNotFoundError } from "@/lib/activity/noteDelete";

/**
 * Soft-deletes one Contact note (contact-note-delete). The ONLY write: it sets `deleted_at` and `deleted_by_bd_id`. The row,
 * its author and its text (`metadata`) stay, so the deletion is recoverable and the who/when survive. Never a DELETE.
 *
 * Authorization is decided HERE, from the row as stored, never from anything the client sent: the row is locked, its real
 * author is read, and `canDeleteNote` runs against the viewer the server resolved (getCurrentBd). No status recompute: a note
 * is not status evidence (FIXED_STAGE_BY_TYPE in deriveStatus.ts), so removing one cannot move a Contact's stage.
 * One row, one statement: the marker columns are themselves the audit record, so there is no separate audit_log row.
 * Revert (the owner, by hand): `update activity set deleted_at = null, deleted_by_bd_id = null where id = '<id>'`.
 */
export async function softDeleteContactNote(viewer: { id: string; role: string }, activityId: string): Promise<{ personId: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ type: activity.type, personId: activity.personId, actorBdId: activity.actorBdId, deletedAt: activity.deletedAt })
      .from(activity)
      .where(eq(activity.id, activityId))
      .for("update");
    if (!row || row.type !== "note" || !row.personId || row.deletedAt) throw new NoteNotFoundError();
    if (!canDeleteNote(row, viewer)) throw new NoteDeleteForbiddenError();
    await tx
      .update(activity)
      .set({ deletedAt: sql`now()`, deletedByBdId: viewer.id, updatedAt: sql`now()` })
      .where(and(eq(activity.id, activityId), isNull(activity.deletedAt)));
    return { personId: row.personId };
  });
}

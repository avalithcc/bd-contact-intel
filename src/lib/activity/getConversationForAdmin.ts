/**
 * The ONLY path around the BD-scoped conversation privacy rule (design R6;
 * admin-access-audit spec "Admins can always read any BD's conversations" /
 * "Admin conversation views are audit-logged"). Returns `targetBdId`'s
 * `email_sent` activity content for this Contact (unredacted — bypasses
 * `isTimelineEntryVisible`) plus their LinkedIn conversation/messages with
 * this Contact, if any.
 *
 * Callers MUST call `requireAdmin()` first (task 11.3) — this function does
 * not re-check the role itself, only enforces the audit write. The audit row
 * is written BEFORE content is read, in the same transaction (task 11.3), so
 * a read that throws after the audit write still leaves an accurate trail;
 * a transaction rollback on failure means no content was ever returned
 * without its audit entry landing.
 *
 * `targetBdId` must be an existing `bd` row BEFORE the audit insert
 * (fresh-review BLOCKER fix): `auditLog.targetBdId` is an FK, so inserting
 * the audit row for a nonexistent bd would throw a raw FK-violation error
 * (uncaught 500) instead of a handled 404 — and worse, if it somehow didn't
 * throw, callers must never treat a nonexistent target as "audited". The
 * caller (the page) is also responsible for validating `personId`/
 * `targetBdId` as well-formed UUIDs first (src/lib/uuid.ts) — a malformed
 * id hits the same FK-violation/driver-error problem even before this
 * function's own existence check runs.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activity, auditLog, bd, conversation, message, person } from "@/db/schema";
import { shouldAuditConversationView } from "@/lib/activity/conversationAudit";

export interface AdminConversationEmailEntry {
  id: string;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
}

export interface AdminConversationMessage {
  id: string;
  senderName: string | null;
  sentAt: Date;
  subject: string | null;
  content: string;
}

export interface AdminConversationThread {
  conversationTitle: string | null;
  messages: AdminConversationMessage[];
}

export interface AdminConversationData {
  targetBdName: string;
  emailEntries: AdminConversationEmailEntry[];
  linkedin: AdminConversationThread[];
}

export type AdminConversationResult = { kind: "not_found" } | ({ kind: "ok" } & AdminConversationData);

export async function getConversationForAdmin(
  personId: string,
  targetBdId: string,
  actorBdId: string,
): Promise<AdminConversationResult> {
  return db.transaction(async (tx) => {
    // Existence check BEFORE the audit insert (fresh-review BLOCKER fix):
    // `targetBdId` must resolve to a real bd row before we ever write the
    // FK-referencing audit entry, so a missing/deleted bd answers a clean
    // "not_found" instead of an FK-violation error surfacing as an
    // uncaught 500.
    const [targetBdRow] = await tx.select({ name: bd.name }).from(bd).where(eq(bd.id, targetBdId));
    if (!targetBdRow) return { kind: "not_found" };

    if (shouldAuditConversationView(actorBdId, targetBdId)) {
      await tx.insert(auditLog).values({
        actorBdId,
        action: "view_conversation",
        personId,
        targetBdId,
        metadata: {},
      });
    }

    const [personRow] = await tx
      .select({ profileKey: person.profileKey })
      .from(person)
      .where(eq(person.id, personId));

    const emailRows = await tx
      .select({ id: activity.id, createdAt: activity.createdAt, metadata: activity.metadata })
      .from(activity)
      .where(
        and(eq(activity.personId, personId), eq(activity.actorBdId, targetBdId), eq(activity.type, "email_sent")),
      )
      .orderBy(desc(activity.createdAt));

    let linkedin: AdminConversationThread[] = [];
    if (personRow?.profileKey) {
      const conversationRows = await tx
        .select({ id: conversation.id, title: conversation.title })
        .from(conversation)
        .where(and(eq(conversation.bdId, targetBdId), eq(conversation.peerProfileKey, personRow.profileKey)));

      linkedin = await Promise.all(
        conversationRows.map(async (c) => {
          const messageRows = await tx
            .select({
              id: message.id,
              senderName: message.senderName,
              sentAt: message.sentAt,
              subject: message.subject,
              content: message.content,
            })
            .from(message)
            .where(and(eq(message.conversationId, c.id), eq(message.isDraft, false)))
            .orderBy(asc(message.sentAt));
          return { conversationTitle: c.title, messages: messageRows };
        }),
      );
    }

    return {
      kind: "ok",
      targetBdName: targetBdRow.name,
      emailEntries: emailRows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        metadata: r.metadata as Record<string, unknown> | null,
      })),
      linkedin,
    };
  });
}

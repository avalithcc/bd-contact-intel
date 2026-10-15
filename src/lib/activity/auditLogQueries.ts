/**
 * Registro de auditoría (admin-conversation-access mockup, screen 3:
 * admin-conversation.html:310-355). Scoped to the two "an admin read another
 * BD's private content" actions: `view_conversation` (owner decision,
 * 2026-09-30) and `view_sequence` (outreach-sequences: an admin opening
 * another BD's Sequence and its draft bodies; a write nobody could read would
 * be theatre). Merges/unmerges already have their own
 * history table, `/admin/duplicates#history`). No retention window: shows
 * everything, paginated (owner decision) — `audit_log` has no TTL today.
 *
 * Two queries per page — a count and the joined rows — same shape as every
 * other paginated list in this repo (e.g. getCompanyListPage): never a
 * per-row query for the actor/contact/target names, which come from two
 * `bd` joins (aliased — an audit_log row has both an actor AND a target bd)
 * plus one `person` join.
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { auditLog, bd, person, sequence } from "@/db/schema";
import { SEQUENCE_READ_AUDIT_ACTION } from "@/lib/sequences/readAudit";
import { paginationRange } from "@/lib/pagination";

const actorBd = alias(bd, "audit_log_actor_bd");
const targetBd = alias(bd, "audit_log_target_bd");

export interface ConversationAuditLogRow {
  id: string;
  /** `view_conversation` or `view_sequence`; a sequence row has no person and names the Sequence instead. */
  action: string;
  sequenceId: string | null;
  sequenceName: string | null;
  at: Date;
  actorBdId: string;
  actorName: string;
  personId: string | null;
  personName: string | null;
  targetBdId: string | null;
  targetBdName: string | null;
}

export interface ConversationAuditLogPage {
  rows: ConversationAuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listConversationAuditLog(page: number, pageSize: number): Promise<ConversationAuditLogPage> {
  const where = inArray(auditLog.action, ["view_conversation", SEQUENCE_READ_AUDIT_ACTION]);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(where);
  const total = totalRow?.count ?? 0;
  const { totalPages, offset } = paginationRange(page, pageSize, total);

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      sequenceId: sequence.id,
      sequenceName: sequence.name,
      at: auditLog.at,
      actorBdId: auditLog.actorBdId,
      actorName: actorBd.name,
      personId: auditLog.personId,
      personFirstName: person.firstName,
      personLastName: person.lastName,
      targetBdId: auditLog.targetBdId,
      targetBdName: targetBd.name,
    })
    .from(auditLog)
    .innerJoin(actorBd, eq(actorBd.id, auditLog.actorBdId))
    .leftJoin(person, eq(person.id, auditLog.personId))
    .leftJoin(targetBd, eq(targetBd.id, auditLog.targetBdId))
    // metadata.sequenceId is written by our own code only; compared as text so a stray value can never raise a cast error.
    .leftJoin(sequence, sql`${sequence.id}::text = ${auditLog.metadata}->>'sequenceId'`)
    .where(where)
    .orderBy(desc(auditLog.at))
    .limit(pageSize)
    .offset(offset);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      action: r.action,
      sequenceId: r.sequenceId,
      sequenceName: r.sequenceName,
      at: r.at,
      actorBdId: r.actorBdId,
      actorName: r.actorName,
      personId: r.personId,
      personName: [r.personFirstName, r.personLastName].filter(Boolean).join(" ") || null,
      targetBdId: r.targetBdId,
      targetBdName: r.targetBdName,
    })),
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * DB glue for the 08:30 ART daily task-reminder digest
 * (src/app/api/tasks/digest/route.ts). Imports `db` (side-effecting,
 * requires DATABASE_URL) so — same convention as
 * src/lib/contacts/manualSignalDb.ts — this file is not unit-tested
 * directly; the tested logic lives in src/lib/tasks/digest.ts (pure
 * grouping/rendering) and src/lib/tasks/argentinaDate.ts (pure day math).
 */
import { and, asc, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { bd, company, person, task, taskDigestSend } from "@/db/schema";
import type { DigestTask } from "@/lib/tasks/digest";
import { abandonedClaimCutoff } from "@/lib/tasks/digestClaim";

export interface DigestTaskRow extends DigestTask {
  bdId: string;
  bdEmail: string;
  bdName: string;
}

/**
 * One batched read for every BD's due-or-overdue open tasks (engineering
 * rule: "Batched reads — one query for all BDs' open tasks, not one per
 * BD"). Bounded by `before` (ART "tomorrow starts", so nothing due in the
 * future is ever fetched) and `limit` (data-builder rule: every read has a
 * LIMIT, even though this table is small today). Ordered by `bdId` so the
 * caller can group consecutive rows per BD in one pass without a Map lookup
 * per row, though a Map is used anyway for clarity.
 */
export async function getDigestTasksForAllBds(before: Date, limit = 5000): Promise<DigestTaskRow[]> {
  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      dueAt: task.dueAt,
      personId: task.personId,
      companyKey: task.companyKey,
      subjectPersonFirstName: person.firstName,
      subjectPersonLastName: person.lastName,
      subjectPersonCompany: person.company,
      subjectCompanyName: company.displayName,
      bdId: bd.id,
      bdEmail: bd.email,
      bdName: bd.name,
    })
    .from(task)
    .innerJoin(bd, eq(task.assignedToBdId, bd.id))
    .leftJoin(person, eq(task.personId, person.id))
    .leftJoin(company, eq(task.companyKey, company.companyKey))
    .where(and(eq(task.status, "open"), isNotNull(task.dueAt), lt(task.dueAt, before)))
    .orderBy(asc(bd.id), asc(task.dueAt))
    .limit(limit);

  // `dueAt` is NOT NULL by the WHERE clause above, but the column itself is
  // nullable in the schema, so drizzle's inferred type is `Date | null` —
  // narrow it here once instead of forcing every caller to re-check.
  return rows.map((row) => ({ ...row, dueAt: row.dueAt! }));
}

/**
 * Groups already-fetched rows by `bdId`, preserving each BD's row order.
 * Pure — no I/O, but lives here (not digest.ts) since its input shape
 * (`DigestTaskRow`) is DB-query-specific.
 */
export function groupDigestTaskRowsByBd(rows: readonly DigestTaskRow[]): Map<string, DigestTaskRow[]> {
  const byBd = new Map<string, DigestTaskRow[]>();
  for (const row of rows) {
    const existing = byBd.get(row.bdId);
    if (existing) existing.push(row);
    else byBd.set(row.bdId, [row]);
  }
  return byBd;
}

/**
 * Claims one BD's digest send for one Argentina calendar date — the
 * idempotency gate (idempotency rule: "the cron claims the row BEFORE
 * sending"). Returns the claimed row's id when this call may send, `null`
 * when it must not (already `sent`, a deliberately-unretried `failed`, or
 * legitimately claimed by a still-running invocation) — the caller must
 * send only when it gets an id back.
 *
 * Two paths can produce a claim:
 * 1. A fresh insert (`on conflict (bd_id, send_date) do nothing`) — the
 *    common case, no row existed yet for (bdId, sendDate).
 * 2. A reclaim of an abandoned row (digest-hardening backlog): if a row
 *    already exists, it can only be because the fresh insert above
 *    conflicted, so this reaches an atomic `UPDATE ... WHERE status =
 *    'pending' AND created_at < abandonedClaimCutoff(now)`. Setting
 *    `created_at` to `now` in that same UPDATE both re-arms the
 *    abandonment clock for this new attempt and makes the race safe: two
 *    concurrent runs hitting this UPDATE for the same row can never both
 *    get an id back, because whichever commits first moves `created_at`
 *    past the other's cutoff before it re-evaluates the WHERE clause.
 */
export async function claimDigestSend(bdId: string, sendDate: string, now: Date): Promise<string | null> {
  const [inserted] = await db
    .insert(taskDigestSend)
    .values({ bdId, sendDate, status: "pending" })
    .onConflictDoNothing({ target: [taskDigestSend.bdId, taskDigestSend.sendDate] })
    .returning({ id: taskDigestSend.id });
  if (inserted) return inserted.id;

  const cutoff = abandonedClaimCutoff(now);
  const [reclaimed] = await db
    .update(taskDigestSend)
    .set({ createdAt: now })
    .where(
      and(
        eq(taskDigestSend.bdId, bdId),
        eq(taskDigestSend.sendDate, sendDate),
        eq(taskDigestSend.status, "pending"),
        lt(taskDigestSend.createdAt, cutoff),
      ),
    )
    .returning({ id: taskDigestSend.id });
  return reclaimed?.id ?? null;
}

export interface DigestSendCounts {
  subject: string;
  todayCount: number;
  overdueCount: number;
  yesterdayCount: number;
}

export async function markDigestSent(id: string, info: DigestSendCounts): Promise<void> {
  await db
    .update(taskDigestSend)
    .set({
      status: "sent",
      subject: info.subject,
      todayCount: info.todayCount,
      overdueCount: info.overdueCount,
      yesterdayCount: info.yesterdayCount,
      sentAt: new Date(),
    })
    .where(eq(taskDigestSend.id, id));
}

/** `error` must already be sanitized — see src/lib/tasks/sendErrorSanitizer.ts. */
export async function markDigestFailed(id: string, error: string): Promise<void> {
  await db.update(taskDigestSend).set({ status: "failed", error }).where(eq(taskDigestSend.id, id));
}

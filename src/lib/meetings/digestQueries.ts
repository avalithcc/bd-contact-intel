/**
 * DB glue for the 18:00 (Argentina) meetings email (src/app/api/meetings/digest/route.ts). Imports `db`, so it is exercised by
 * tests/db/meetingDigest.test.ts; the tested decisions (who gets an email, what it says) are in digest.ts. The claim works like
 * the task digest's (src/lib/tasks/digestQueries.ts): the row is inserted BEFORE sending, so a repeated run on the same Argentina
 * day never mails a BD twice, and a run that died mid-send is reclaimed only after the abandonment threshold.
 */
import { and, asc, eq, lt, lte } from "drizzle-orm";
import { db } from "@/db";
import { bd, meeting, meetingDigestSend, person } from "@/db/schema";
import { abandonedClaimCutoff } from "@/lib/tasks/digestClaim";
import type { DigestMeetingRow } from "@/lib/meetings/digest";

type Executor = Pick<typeof db, "select" | "insert" | "update">;

/** Every BD's meetings that are scheduled and whose time has passed, in one bounded read (rule: every read has a LIMIT). */
export function getUnconfirmedMeetingsForDigest(now: Date, limit = 5000, executor: Executor = db): Promise<DigestMeetingRow[]> {
  return executor
    .select({
      meetingId: meeting.id,
      bdId: bd.id,
      bdName: bd.name,
      bdEmail: bd.email,
      firstName: person.firstName,
      lastName: person.lastName,
      company: person.company,
      scheduledAt: meeting.scheduledAt,
    })
    .from(meeting)
    .innerJoin(bd, eq(bd.id, meeting.bdId))
    .innerJoin(person, eq(person.id, meeting.personId))
    .where(and(eq(meeting.status, "scheduled"), lte(meeting.scheduledAt, now)))
    .orderBy(asc(bd.id), asc(meeting.scheduledAt))
    .limit(limit);
}

/**
 * Claims one BD's email for one Argentina calendar date. Returns the claimed row's id when this call may send, null when it
 * must not (already `sent`, a deliberately-unretried `failed`, or claimed by a run still in progress).
 */
export async function claimMeetingDigest(bdId: string, sendDate: string, now: Date, executor: Executor = db): Promise<string | null> {
  const [inserted] = await executor
    .insert(meetingDigestSend)
    .values({ bdId, sendDate, status: "pending" })
    .onConflictDoNothing({ target: [meetingDigestSend.bdId, meetingDigestSend.sendDate] })
    .returning({ id: meetingDigestSend.id });
  if (inserted) return inserted.id;

  const [reclaimed] = await executor
    .update(meetingDigestSend)
    .set({ createdAt: now })
    .where(
      and(
        eq(meetingDigestSend.bdId, bdId),
        eq(meetingDigestSend.sendDate, sendDate),
        eq(meetingDigestSend.status, "pending"),
        lt(meetingDigestSend.createdAt, abandonedClaimCutoff(now)),
      ),
    )
    .returning({ id: meetingDigestSend.id });
  return reclaimed?.id ?? null;
}

export async function markMeetingDigestSent(
  id: string,
  info: { subject: string; todayCount: number; olderCount: number },
  executor: Executor = db,
): Promise<void> {
  await executor
    .update(meetingDigestSend)
    .set({ status: "sent", subject: info.subject, todayCount: info.todayCount, olderCount: info.olderCount, sentAt: new Date() })
    .where(eq(meetingDigestSend.id, id));
}

/** `error` must already be sanitized (src/lib/tasks/sendErrorSanitizer.ts). */
export async function markMeetingDigestFailed(id: string, error: string, executor: Executor = db): Promise<void> {
  await executor.update(meetingDigestSend).set({ status: "failed", error }).where(eq(meetingDigestSend.id, id));
}

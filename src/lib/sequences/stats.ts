/**
 * The numbers on the Sequence detail screen (sequence-detail-view "Stat cards and progress are computed from member
 * data"), derived from current member states and nothing else. Pure, so the arithmetic is pinned by a test rather than
 * re-derived in a component.
 *
 * Two rules that are easy to get wrong:
 *  - "Enviados" counts every member whose step 1 went out, INCLUDING those who later replied or never answered, so a
 *    replied member is in both "Enviados" and "Respondieron". Only `sent` is still awaiting a reminder.
 *  - A discarded member is in the total (the progress line says "de 10") but is never "sin respuesta": the finished
 *    copy counts `no_reply` members, not total minus replied.
 */
import { SENT_STATES, type MemberState } from "./memberState";

export type StatMember = {
  state: MemberState;
  /** A step 1 draft exists. A drafted member without one is not "ready" and cannot be approved. */
  hasDraft: boolean;
  /** The step 1 draft's release instant; only read for approved members. */
  scheduledFor: Date | null;
};

export type SequenceStats = {
  total: number;
  toReview: number;
  queued: number;
  nextReleaseAt: Date | null;
  sent: number;
  awaitingReminder: number;
  replied: number;
  /** `empty`: members and no draft yet. `finished`: nothing drafted, approved or awaiting a reminder. */
  view: "empty" | "live" | "finished";
  finished: { replied: number; noReply: number; total: number };
  /**
   * The progress bar. `rest` is "sin salir": everything neither sent nor queued, so it holds the drafts to review AND
   * the discarded. It exists so the track always fills to 100% (the approved mockup's 40/20/40); the spec's earlier
   * wording (sent / queued / to-review) stopped at 90% on the mockup's own dataset and read as a rendering bug.
   */
  segments: { sentPct: number; queuedPct: number; restPct: number; rest: number };
};

const pct = (n: number, total: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);

export function sequenceStats(members: readonly StatMember[]): SequenceStats {
  const count = (pred: (m: StatMember) => boolean) => members.filter(pred).length;
  const total = members.length;
  const sent = count((m) => (SENT_STATES as readonly string[]).includes(m.state));
  const queued = count((m) => m.state === "approved");
  const replied = count((m) => m.state === "replied");
  const noReply = count((m) => m.state === "no_reply");
  const live = count((m) => m.state === "drafted" || m.state === "approved" || m.state === "sent");
  const sentPct = pct(sent, total);
  const queuedPct = pct(queued, total);
  const release = members.filter((m) => m.state === "approved" && m.scheduledFor).map((m) => m.scheduledFor!.getTime());

  const view = total > 0 && !members.some((m) => m.hasDraft) ? "empty" : total > 0 && live === 0 && sent > 0 ? "finished" : "live";
  return {
    total,
    toReview: count((m) => m.state === "drafted" && m.hasDraft),
    queued,
    nextReleaseAt: release.length ? new Date(Math.min(...release)) : null,
    sent,
    awaitingReminder: count((m) => m.state === "sent"),
    replied,
    view,
    finished: { replied, noReply, total },
    // The remainder of the rounded parts, not a third rounding, so the three always add to exactly 100.
    segments: { sentPct, queuedPct, restPct: total === 0 ? 0 : Math.round((100 - sentPct - queuedPct) * 10) / 10, rest: total - sent - queued },
  };
}

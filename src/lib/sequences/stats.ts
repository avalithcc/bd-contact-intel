/**
 * The numbers on the Sequence detail screen (sequence-detail-view "Stat cards and progress are computed from member
 * data"), derived from current member states and nothing else. Pure, so the arithmetic is pinned by a test rather than
 * re-derived in a component.
 *
 * Two rules that are easy to get wrong:
 *  - "Enviados" counts every member whose step 1 went out (`sent_at` set), whatever happened to them afterwards: a
 *    replied member is in both "Enviados" and "Respondieron", and a member who bounced or was discarded after the email
 *    left is still an email that left. Only state `sent` is still awaiting a reminder.
 *  - "No contactables" is a bounce or an opt-out THIS Sequence wrote to (`sent_at` set). A hard bounce discards the
 *    member in every Sequence holding that address, so without the `sent_at` condition the tile would count people
 *    this Sequence never wrote to and the rate would be fiction.
 *  - A discarded member is in the total (the progress line says "de 10") but is never "sin respuesta": the finished
 *    copy counts `no_reply` members, not total minus replied.
 */
import type { MemberState } from "./memberState";

export type StatMember = {
  state: MemberState;
  /** A step 1 draft exists. A drafted member without one is not "ready" and cannot be approved. */
  hasDraft: boolean;
  /** The step 1 draft's release instant; only read for approved members. */
  scheduledFor: Date | null;
  /** When step 1 went out; null if it never did. Drives "Enviados" and "No contactables". */
  sentAt: Date | null;
  /** Why the member was discarded (`bounce`, `opt_out`, ...); null when it was not. */
  discardReason: string | null;
};

const UNCONTACTABLE_REASONS = ["bounce", "opt_out"];

export type SequenceStats = {
  total: number;
  toReview: number;
  queued: number;
  nextReleaseAt: Date | null;
  sent: number;
  awaitingReminder: number;
  /** Bounced or opted out after this Sequence wrote to them. */
  notContactable: number;
  /** Over what actually went out (`sent`), rounded to a whole percent; 0 when nothing went out. */
  notContactablePct: number;
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
  const sent = count((m) => m.sentAt !== null);
  const notContactable = count((m) => m.sentAt !== null && m.discardReason !== null && UNCONTACTABLE_REASONS.includes(m.discardReason));
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
    notContactable,
    notContactablePct: sent === 0 ? 0 : Math.round((notContactable / sent) * 100),
    replied,
    view,
    finished: { replied, noReply, total },
    // The remainder of the rounded parts, not a third rounding, so the three always add to exactly 100.
    segments: { sentPct, queuedPct, restPct: total === 0 ? 0 : Math.round((100 - sentPct - queuedPct) * 10) / 10, rest: total - sent - queued },
  };
}

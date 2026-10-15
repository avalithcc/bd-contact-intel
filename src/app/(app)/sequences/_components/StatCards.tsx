import { fill, miamiWhen, type SequenceLabels } from "@/lib/sequences/viewText";
import type { SequenceStats } from "@/lib/sequences/stats";

/** The queue foot names the next release: "mañana 09:00", "hoy 09:00", or "17/10 09:00" when it is further out. */
export function queuedFoot(nextReleaseAt: Date | null, now: Date, l: SequenceLabels): string {
  if (!nextReleaseAt) return l.statQueuedNone;
  const w = miamiWhen(nextReleaseAt, now);
  const when = w.day === "today" ? l.whenToday : w.day === "tomorrow" ? l.whenTomorrow : w.ddmm;
  return fill(l.statQueuedFoot, { when: `${when} ${w.hhmm}` });
}

export function StatCards({ stats, now, labels: l }: { stats: SequenceStats; now: Date; labels: SequenceLabels }) {
  const cards = [
    { tone: "info", label: l.statReview, value: stats.toReview, foot: l.statReviewFoot },
    { tone: "accent", label: l.statQueued, value: stats.queued, foot: queuedFoot(stats.nextReleaseAt, now, l) },
    { tone: "neutral", label: l.statSent, value: stats.sent, foot: stats.awaitingReminder === 1 ? l.statSentFootOne : fill(l.statSentFoot, { n: stats.awaitingReminder }) },
    { tone: "success", label: l.statReplied, value: stats.replied, foot: l.statRepliedFoot },
  ];
  return (
    <div className="grid-4 mb-lg">
      {cards.map((c) => (
        <div key={c.tone} className={`stat ${c.tone}`}>
          <div className="label">{c.label}</div>
          <div className="value">{c.value}</div>
          <div className="foot">{c.foot}</div>
        </div>
      ))}
    </div>
  );
}

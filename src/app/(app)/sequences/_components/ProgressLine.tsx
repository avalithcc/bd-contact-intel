import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import type { SequenceStats } from "@/lib/sequences/stats";

// Three segments, as in the approved mockup (40/20/40). The third, neutral one is "sin salir": everything neither sent
// nor queued, so it contains the drafts still to review AND the discarded members. It exists so the track fills to 100%;
// a bar that stopped at 90% (the spec's old to-review-only wording) would read as a rendering bug. Owner decision.
export function ProgressLine({ stats, finished, labels: l }: { stats: SequenceStats; finished: boolean; labels: SequenceLabels }) {
  const replies = stats.replied === 0 ? null : fill(stats.replied === 1 ? l.progressRepliesOne : l.progressRepliesMany, { n: stats.replied });
  const tail = fill(finished ? l.progressFinal : l.progressLine, { total: stats.total });
  return (
    <div className="row between wrap mb-lg" role="group">
      <div className="row"><strong>{stats.sent}</strong><span className="meta">{replies ? `${tail} · ${replies}` : tail}</span></div>
      <div className="bar-track" style={{ width: 260 }} role="img" aria-label={fill(l.progressBar, { sent: stats.sent, total: stats.total, queued: stats.queued, rest: stats.segments.rest })}>
        <span className="bar-success" style={{ width: `${stats.segments.sentPct}%` }} />
        <span className="bar-info" style={{ width: `${stats.segments.queuedPct}%` }} />
        <span className="bar-neutral" style={{ width: `${stats.segments.restPct}%` }} />
      </div>
    </div>
  );
}

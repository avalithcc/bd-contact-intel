import { CheckCircleIcon, FileIcon } from "@/components/icons";
import type { SequenceStats } from "@/lib/sequences/stats";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import type { OnAction } from "./actions";

export function EmptyState({ total, labels: l, onAction }: { total: number; labels: SequenceLabels; onAction: OnAction }) {
  return (
    <div className="card">
      <div className="empty">
        <div className="empty-icon"><FileIcon className="icon icon-lg" /></div>
        <h3>{total === 1 ? l.emptyTitleOne : fill(l.emptyTitle, { n: total })}</h3>
        <p>{l.emptyBody}</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onAction({ type: "generateMissing" })}>{total === 1 ? l.emptyCtaOne : fill(l.emptyCta, { n: total })}</button>
      </div>
    </div>
  );
}

/** Discarded members are in the total but never in "sin respuesta": `finished.noReply` counts `no_reply` only. */
export function FinishedState({ finished, labels: l, onAction }: { finished: SequenceStats["finished"]; labels: SequenceLabels; onAction: OnAction }) {
  const body = finished.noReply === 0 ? l.finishedBodyAllReplied : l.finishedBody;
  return (
    <div className="card">
      <div className="empty">
        <div className="empty-icon"><CheckCircleIcon className="icon icon-lg" /></div>
        <h3>{l.finishedTitle}</h3>
        <p>{fill(body, { replied: finished.replied, total: finished.total, noReply: finished.noReply })}</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAction({ type: "createNext" })}>{l.finishedCta}</button>
      </div>
    </div>
  );
}

import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import type { OnAction } from "./actions";

/** `readyCount` disables its button at zero: there is nothing to approve, which is not a placeholder. */
export function SequenceHeader({ name, memberCount, readyCount, labels, onAction }: { name: string; memberCount: number; readyCount: number; labels: SequenceLabels; onAction: OnAction }) {
  return (
    <div className="page-header">
      <div className="titles">
        <div className="eyebrow">{labels.eyebrow}</div>
        <h1>{name}<span className="dot">.</span></h1>
        <p className="meta">{fill(labels.introLead, { n: memberCount })} <strong>{labels.introStrong}</strong>. {labels.introTail}</p>
      </div>
      <div className="row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAction({ type: "editSequence" })}>{labels.editSequence}</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={readyCount === 0} onClick={() => onAction({ type: "approveReady" })}>{readyCount === 1 ? labels.approveReadyOne : fill(labels.approveReady, { n: readyCount })}</button>
      </div>
    </div>
  );
}

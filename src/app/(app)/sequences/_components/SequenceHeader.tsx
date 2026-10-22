import Link from "next/link";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import type { OnAction } from "./actions";

/** `readyCount` disables its button at zero: there is nothing to approve, which is not a placeholder. `readOnly` (another BD's Sequence) drops both write buttons for a way back, and words the intro around the owner and the sender account. */
export function SequenceHeader({ name, memberCount, readyCount, labels, onAction, readOnly = null, generating = false }: { name: string; memberCount: number; readyCount: number; labels: SequenceLabels; onAction: OnAction; readOnly?: { ownerName: string; fromAddress: string } | null; generating?: boolean }) {
  const intro = readOnly ? { owner: readOnly.ownerName, from: readOnly.fromAddress } : null;
  return (
    <div className="page-header">
      <div className="titles">
        <div className="eyebrow">{labels.eyebrow}</div>
        <h1>{name}<span className="dot">.</span></h1>
        <p className="meta">{intro ? <>{fill(labels.readOnlyIntroLead, { n: memberCount, ...intro })} <strong>{fill(labels.readOnlyIntroStrong, intro)}</strong>. {fill(labels.readOnlyIntroTail, intro)}</> : <>{fill(labels.introLead, { n: memberCount })} <strong>{labels.introStrong}</strong>. {labels.introTail}</>}</p>
      </div>
      <div className="row">
        {readOnly ? <Link className="btn btn-ghost btn-sm" href="/sequences?scope=all">{labels.readOnlyBack}</Link> : <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAction({ type: "editSequence" })}>{labels.editSequence}</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={readyCount === 0 || generating} title={generating ? labels.generateBulkWaitTitle : undefined} onClick={() => onAction({ type: "approveReady" })}>{readyCount === 1 ? labels.approveReadyOne : fill(labels.approveReady, { n: readyCount })}</button>
        </>}
      </div>
    </div>
  );
}

import { isReadOnlyView } from "@/lib/sequences/readOnly";
import { fill } from "@/lib/sequences/viewText";
import type { GenerationLock } from "@/lib/sequences/generationLock";
import { EyeIcon } from "@/components/icons";
import { sequenceStats } from "@/lib/sequences/stats";
import type { ReactNode } from "react";
import type { SequenceDetail } from "@/lib/sequences/detailQueries";
import type { SequenceLabels } from "@/lib/sequences/viewText";
import type { OnAction } from "./actions";
import type { SequenceSendContext } from "./sendContext";
import { CadenceCard } from "./CadenceCard";
import { MemberCard } from "./MemberCard";
import { ProgressLine } from "./ProgressLine";
import { SequenceHeader } from "./SequenceHeader";
import { EmptyState, FinishedState } from "./StateCards";
import { StatCards } from "./StatCards";

/**
 * `selected` / `onToggle` / `bulk` are the container's bulk selection: draft cards get a checkbox and `bulk` (the BulkBar) sits above the cards.
 * `lock` is required (never defaulted to unlocked) and `bulk` is a render function that receives it, so the bulk bar cannot be mounted without being told whether a generation is in flight.
 * `optOutPhrases` maps memberId to the advisory phrase the container found in that member's reply (detectOptOutPhrase); a replied card with an entry shows the "No contactar" prompt.
 * Presentational (mounted by SequenceDetailScreen): it reports intent through `onAction` and holds no state, so the container that mounts it
 * owns dialogs and server actions. Which blocks show follows `sequenceStats(...).view`:
 *  - empty: header, cadence, the empty state and the member cards: with no batch generation, each card's own "Generar borrador" is the only way to create a draft.
 *  - finished: header, the final progress line and "Secuencia completa", then the cards (so a replied contact stays one
 *    click away). Showing the cards here is NOT in the mockup; flagged in the checklist as an owner decision.
 *  - live: header, stat cards, progress, cadence, cards.
 */
export function SequenceDetailView({ detail, labels, now, onAction, viewerBdId, optOutPhrases = {}, selected, onToggle, bulk, lock, send }: { send: SequenceSendContext; detail: SequenceDetail; labels: SequenceLabels; now: Date; onAction: OnAction; viewerBdId: string; optOutPhrases?: Readonly<Record<string, string>>; selected?: ReadonlySet<string>; onToggle?: (memberId: string) => void; bulk?: (lock: GenerationLock) => ReactNode; lock: GenerationLock }) {
  // An admin reads another BD's Sequence (audited): the cards must not word its approvals as the reader's own.
  const readOnly = isReadOnlyView(viewerBdId, detail.ownerBdId);
  const ownView = !readOnly;
  const stats = sequenceStats(detail.members.map((m) => ({ state: m.state, hasDraft: m.draft !== null, scheduledFor: m.draft?.scheduledFor ?? null, sentAt: m.sentAt, discardReason: m.discardReason })));
  return (
    <>
      {readOnly && (
        <div className="alert alert-neutral mb-lg" role="note"><EyeIcon className="icon" /><div><span className="title">{fill(labels.readOnlyTitle, { owner: detail.ownerName })}</span> {labels.readOnlyBody}</div></div>
      )}
      <SequenceHeader name={detail.name} memberCount={stats.total} readyCount={stats.toReview} labels={labels} onAction={onAction} readOnly={readOnly ? { ownerName: detail.ownerName, fromAddress: detail.fromAddress } : null} lock={lock} />
      {lock.active && (
        <div className="alert alert-info mb-lg" role="status"><span className="spinner-standalone" aria-hidden="true" /><div><strong>{fill(labels.generatingBannerTitle, { name: lock.generatingName ?? "" })}</strong> {labels.generatingBannerBody} <span className="meta">{labels.generatingBannerFail}</span></div></div>
      )}
      {stats.view === "live" && <StatCards stats={stats} now={now} labels={labels} />}
      {stats.view !== "empty" && <ProgressLine stats={stats} finished={stats.view === "finished"} labels={labels} />}
      {stats.view !== "finished" && <CadenceCard schedule={detail.schedule} labels={labels} onAction={onAction} readOnly={readOnly} />}
      {stats.view === "empty" && <EmptyState total={stats.total} labels={labels} />}
      {stats.view === "finished" && <FinishedState finished={stats.finished} labels={labels} onAction={onAction} readOnly={readOnly} />}
      <h2 className={stats.view !== "live" ? "mt-2xl mb-lg" : "mb-lg"}>{labels.membersTitle}</h2>
      {!readOnly && bulk?.(lock)}
      <div className="stack">
        {detail.members.map((m) => <MemberCard key={m.memberId} member={m} now={now} labels={labels} onAction={onAction} ownView={ownView} readOnly={readOnly} optOutPhrase={optOutPhrases[m.memberId] ?? null} generation={lock} send={send} selection={!readOnly && selected && onToggle ? { selected: selected.has(m.memberId), onToggle: () => onToggle(m.memberId) } : undefined} />)}
      </div>
    </>
  );
}

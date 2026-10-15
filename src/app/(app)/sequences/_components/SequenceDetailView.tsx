import { sequenceStats } from "@/lib/sequences/stats";
import type { SequenceDetail } from "@/lib/sequences/detailQueries";
import type { SequenceLabels } from "@/lib/sequences/viewText";
import type { OnAction } from "./actions";
import { CadenceCard } from "./CadenceCard";
import { MemberCard } from "./MemberCard";
import { ProgressLine } from "./ProgressLine";
import { SequenceHeader } from "./SequenceHeader";
import { EmptyState, FinishedState } from "./StateCards";
import { StatCards } from "./StatCards";

/**
 * `optOutPhrases` maps memberId to the advisory phrase the container found in that member's reply (detectOptOutPhrase); a replied card with an entry shows the "No contactar" prompt.
 * Presentational and unrouted: it reports intent through `onAction` and holds no state, so the container that mounts it
 * (go-live PR) owns dialogs and server actions. Which blocks show follows `sequenceStats(...).view`:
 *  - empty: header, cadence and the empty state; no member cards (sequence-detail-view "Freshly created").
 *  - finished: header, the final progress line and "Secuencia completa", then the cards (so a replied contact stays one
 *    click away). Showing the cards here is NOT in the mockup; flagged in the checklist as an owner decision.
 *  - live: header, stat cards, progress, cadence, cards.
 */
export function SequenceDetailView({ detail, labels, now, onAction, viewerBdId, optOutPhrases = {} }: { detail: SequenceDetail; labels: SequenceLabels; now: Date; onAction: OnAction; viewerBdId: string; optOutPhrases?: Readonly<Record<string, string>> }) {
  // An admin reads another BD's Sequence (audited): the cards must not word its approvals as the reader's own.
  const ownView = viewerBdId === detail.ownerBdId;
  const stats = sequenceStats(detail.members.map((m) => ({ state: m.state, hasDraft: m.draft !== null, scheduledFor: m.draft?.scheduledFor ?? null })));
  const missing = detail.members.filter((m) => m.state === "drafted" && m.draft === null).length;
  return (
    <>
      <SequenceHeader name={detail.name} memberCount={stats.total} readyCount={stats.toReview} missingCount={missing} labels={labels} onAction={onAction} />
      {stats.view === "live" && <StatCards stats={stats} now={now} labels={labels} />}
      {stats.view !== "empty" && <ProgressLine stats={stats} finished={stats.view === "finished"} labels={labels} />}
      {stats.view !== "finished" && <CadenceCard schedule={detail.schedule} labels={labels} onAction={onAction} />}
      {stats.view === "empty" && <EmptyState total={stats.total} labels={labels} onAction={onAction} />}
      {stats.view === "finished" && <FinishedState finished={stats.finished} labels={labels} onAction={onAction} />}
      {stats.view !== "empty" && (
        <>
          <h2 className={stats.view === "finished" ? "mt-2xl mb-lg" : "mb-lg"}>{labels.membersTitle}</h2>
          <div className="stack">
            {detail.members.map((m) => <MemberCard key={m.memberId} member={m} now={now} labels={labels} onAction={onAction} ownView={ownView} optOutPhrase={optOutPhrases[m.memberId] ?? null} />)}
          </div>
        </>
      )}
    </>
  );
}

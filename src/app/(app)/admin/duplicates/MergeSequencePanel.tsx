import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { CheckIcon, InfoIcon, WarningIcon } from "@/components/icons";
import { es } from "@/lib/i18n/dictionaries/es";
import { formatArgentinaDayMonthTime, relativeTime } from "@/lib/i18n/format";
import type { MergePanel, PanelAlert, PanelNote, PanelRow, PanelStatus } from "@/lib/sequences/mergePanel";
import { cancelScheduledSendAction, mergeDuplicateCandidateAction } from "./actions";

const t = es.duplicates.mergePanel;

const STATUS_TONE: Record<PanelStatus, string> = { blocked: "warn", ready: "success", repoints: "info", needsConfirmation: "warn" };
const ALERT_TONE: Record<PanelAlert, "warn" | "info" | "success"> = {
  scheduledSend: "warn",
  sendHistoryCollision: "warn",
  sendCancelled: "success",
  sameSequence: "warn",
  sentKept: "info",
};
const STATE_BADGE: Record<string, string> = {
  drafted: "badge-info",
  approved: "badge-brand",
  sent: "badge-contacted",
  replied: "badge-replied",
  no_reply: "badge-neutral",
  discarded: "badge-discarded",
};

function AlertIcon({ tone }: { tone: "warn" | "info" | "success" }) {
  if (tone === "success") return <CheckIcon className="icon" />;
  return tone === "warn" ? <WarningIcon className="icon" /> : <InfoIcon className="icon" />;
}

function noteText(note: PanelNote): React.ReactNode {
  switch (note.kind) {
    case "sendsAt":
      return t.notes.sendsAt(note.at ? formatArgentinaDayMonthTime(note.at) : null);
    case "sentKept":
      return t.notes.sentKept(note.sentAt ? relativeTime(note.sentAt, "es") : null);
    case "discardReason":
      return (
        <>
          {t.notes.discardReason} <span className="mono">{note.reason}</span>
        </>
      );
    default:
      return t.notes[note.kind];
  }
}

function Row({ row, candidateId }: { row: PanelRow; candidateId: string }) {
  const badge =
    row.role === "survives" ? (
      <span className="badge badge-success">{t.roleSurvives}</span>
    ) : row.role === "discarded" ? (
      <span className="badge badge-discarded">{t.roleDiscarded}</span>
    ) : row.state ? (
      <span className={`badge ${STATE_BADGE[row.state] ?? "badge-neutral"}`}>{t.state[row.state] ?? row.state}</span>
    ) : (
      <span className="badge badge-none">—</span>
    );
  return (
    <div className="assoc-row">
      <Avatar id={row.personId} initials={initialsFromName(row.personName)} size="sm" />
      <span className="grow">
        <strong>{row.personName}</strong>
        {row.sequenceName ? (
          <>
            {" "}
            {t.inSequence} <span className="mono">{row.sequenceName}</span>
          </>
        ) : (
          <> · {t.noMemberships}</>
        )}
      </span>
      {badge}
      {row.note && <span className="meta">{noteText(row.note)}</span>}
      {row.cancelMemberId && (
        <form action={cancelScheduledSendAction}>
          <input type="hidden" name="memberId" value={row.cancelMemberId} />
          <input type="hidden" name="candidateId" value={candidateId} />
          <button type="submit" className="btn btn-danger btn-sm">
            {t.cancelSend}
          </button>
        </form>
      )}
    </div>
  );
}

/** Dumb renderer of the merge-with-sequence panel (mockup fusion-con-secuencia.html); every decision is in `panel`. */
export function MergeSequencePanel({
  panel,
  candidateId,
  title,
  survivorName,
}: {
  panel: MergePanel;
  candidateId: string;
  title: string;
  survivorName: string;
}) {
  return (
    <div className="card mt-lg">
      <div className="card-header">
        <h3>{title}</h3>
        <span className={`badge badge-${STATUS_TONE[panel.status]}`}>{t.status[panel.status]}</span>
      </div>
      <div className="card-body">
        {panel.alerts.map((key) => {
          const tone = ALERT_TONE[key];
          const copy = t.alerts[key];
          return (
            <div key={key} className={`alert alert-${tone} mb-lg`}>
              <AlertIcon tone={tone} />
              <div>
                {copy.title && <span className="title">{copy.title}</span>} {copy.body}
              </div>
            </div>
          );
        })}
        <div className="assoc">
          {panel.rows.map((row) => (
            <Row key={`${row.memberId ?? "none"}-${row.personId}`} row={row} candidateId={candidateId} />
          ))}
        </div>
        {panel.help && <p className="help mt-lg">{t.help[panel.help]}</p>}
      </div>
      <div className="card-footer row between">
        <span className="meta">
          {panel.footerNote === "survives" ? t.footer.survives(survivorName) : t.footer[panel.footerNote]}
        </span>
        <span className="row">
          <Link href="/admin/duplicates" className="btn btn-secondary btn-sm">
            {t.backToDuplicates}
          </Link>
          <form action={mergeDuplicateCandidateAction}>
            <input type="hidden" name="candidateId" value={candidateId} />
            <input type="hidden" name="acknowledgeSequences" value="on" />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!panel.canMerge}>
              {t[panel.mergeLabel]}
            </button>
          </form>
        </span>
      </div>
    </div>
  );
}

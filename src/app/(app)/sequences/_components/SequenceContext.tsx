"use client";

import { Fragment, type ReactNode } from "react";
import { contactContextView, type ContactMembership, type MembershipRow } from "@/lib/sequences/contactContext";
import { agoText, fill, miamiWhen, type SequenceLabels } from "@/lib/sequences/viewText";
import { miamiCalendarDate } from "@/lib/sequences/miamiTime";
import type { OnContactContextAction } from "./actions";

function metaParts(r: MembershipRow, now: Date, l: SequenceLabels): ReactNode[] {
  const m = r.membership;
  const ago = (d: Date) => agoText(d, now, l);
  const sent = m.sentAt ? fill(l.emailSent, { ago: ago(m.sentAt) }) : null;
  const reason = m.discardReason ? fill(l.reason, { reason: (l.discardReasons as Record<string, string>)[m.discardReason] ?? m.discardReason }) : null;
  const removed = m.discardedAt ? fill(l.contextRemoved, { ago: ago(m.discardedAt) }) : null;
  switch (r.kind) {
    case "approved": {
      if (!m.scheduledFor) return [];
      const w = miamiWhen(m.scheduledFor, now);
      return [<>{l.releases} {w.day === "today" ? l.whenToday : w.day === "tomorrow" ? l.whenTomorrow : l.whenOn} <strong>{w.ddmm} {l.atTime} {w.hhmm}</strong></>];
    }
    case "sent": case "noReply": return sent ? [sent] : [];
    case "replied": return [sent, m.repliedAt && <strong>{fill(l.repliedAgo, { ago: ago(m.repliedAt) })}</strong>].filter(Boolean);
    case "discardedUnsent": return [removed, l.contextNeverSent, reason].filter(Boolean);
    case "discardedSent": return [removed, sent, reason].filter(Boolean);
    case "optedOut": {
      const d = m.discardedAt ? miamiCalendarDate(m.discardedAt) : null;
      return [d ? fill(l.contextOptedOut, { date: `${d.slice(8, 10)}/${d.slice(5, 7)}` }) : l.contextOptedOutNoDate];
    }
    default: return [];
  }
}

/**
 * Contact-record right-rail block (the `.card.assoc` pattern of contact-record.html): the Contact's Sequence membership
 * and state, and the "No contactar" control. Presentational and unmounted: it reports `optOut` intent and the container
 * opens `OptOutDialog` (task 13.6 mounts both). Renders nothing for a Contact in no Sequence.
 */
export function SequenceContext({ memberships, now, labels: l, onAction }: { memberships: readonly ContactMembership[]; now: Date; labels: SequenceLabels; onAction: OnContactContextAction }) {
  const v = contactContextView(memberships);
  if (v.rows.length === 0) return null;
  return (
    <div className="card assoc">
      <div className="card-header"><h3>{l.contextTitle}</h3><span className="meta">{v.rows.length}</span></div>
      <div className="card-body">
        {v.rows.map((r) => {
          const parts = metaParts(r, now, l);
          return (
            <div key={r.membership.memberId} className="assoc-row">
              <div className="grow">
                <div className="n">{r.membership.sequenceName}</div>
                {parts.length > 0 && <div className="s">{parts.map((p, i) => <Fragment key={i}>{i > 0 && " · "}{p}</Fragment>)}</div>}
              </div>
              <span className={`badge badge-${r.tone}`}>{l.contextBadges[r.kind]}</span>
            </div>
          );
        })}
      </div>
      {v.optOutMemberId && (
        <div className="card-footer">
          <button type="button" className="btn btn-danger btn-sm" onClick={() => onAction({ type: "optOut", memberId: v.optOutMemberId! })}>{l.optOutAction}</button>
        </div>
      )}
    </div>
  );
}

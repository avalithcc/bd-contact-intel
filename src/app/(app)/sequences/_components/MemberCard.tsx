import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { DropdownMenu } from "@/components/DropdownMenu";
import { MoreIcon } from "@/components/icons";
import { initialsFromName } from "@/components/initials";
import { showOptOutPrompt } from "@/lib/sequences/contactContext";
import type { DetailMember } from "@/lib/sequences/detailQueries";
import { mapMemberCard, type CardActionId, type CardKind, type CardView } from "@/lib/sequences/memberCard";
import { agoText, fill, miamiWhen, type SequenceLabels } from "@/lib/sequences/viewText";
import type { OnAction } from "./actions";

/** The meta line as parts, joined by " · ". The state table decides WHICH kind; this only words it from the facts. */
function metaParts(m: DetailMember, kind: CardKind, now: Date, l: SequenceLabels, ownView: boolean): ReactNode[] {
  const ago = (d: Date) => agoText(d, now, l);
  const parts: ReactNode[] = [];
  if (kind === "draft") {
    if (m.openIt > 0) parts.push(fill(m.openIt === 1 ? l.postingsOne : l.postingsMany, { n: m.openIt }));
    if (m.emailVerified) parts.push(<>{l.metaEmail} <span className="badge badge-verified">{l.emailVerified}</span></>);
    parts.push(m.lastContactAt ? fill(l.lastContact, { ago: ago(m.lastContactAt) }) : l.neverContacted);
  } else if (kind === "noDraft") {
    parts.push(l.noDraftYet);
  } else if (kind === "approved") {
    const at = m.draft?.scheduledFor;
    if (at) {
      const w = miamiWhen(at, now);
      const day = w.day === "today" ? l.whenToday : w.day === "tomorrow" ? l.whenTomorrow : l.whenOn;
      parts.push(<>{l.releases} {day} <strong>{w.ddmm} {l.atTime} {w.hhmm}</strong></>);
    }
    // "por vos" only to the owner: an admin reading someone else's Sequence did not approve it, and the read does
    // not fetch who did.
    if (m.draft?.approvedAt) parts.push(fill(ownView ? l.approvedBy : l.approvedByOther, { ago: ago(m.draft.approvedAt) }));
  } else if (kind === "discarded") {
    if (m.discardedAt) parts.push(fill(l.removedAgo, { ago: ago(m.discardedAt) }));
    const known = m.discardReason ? (l.discardReasons as Record<string, string>)[m.discardReason] : null;
    if (m.discardReason) parts.push(fill(l.reason, { reason: known ?? m.discardReason }));
  } else {
    if (m.sentAt) parts.push(fill(l.emailSent, { ago: ago(m.sentAt) }));
    if (kind === "replied") {
      if (m.repliedAt) parts.push(<strong>{fill(l.repliedAgo, { ago: ago(m.repliedAt) })}</strong>);
      parts.push(l.sequenceStopped);
    } else if (kind === "noReply") {
      parts.push(l.noReplyAfterReminder);
    } else if (m.reminderDueAt) {
      parts.push(l.noReply);
      const w = miamiWhen(m.reminderDueAt, now);
      parts.push(kind === "reminderToday" ? fill(l.reminderToday, { time: w.hhmm }) : <strong>{fill(l.reminderOn, { date: w.ddmm })}</strong>);
    }
  }
  return parts;
}

function Actions({ card, m, l, onAction }: { card: CardView; m: DetailMember; l: SequenceLabels; onAction: OnAction }) {
  const contactHref = `/contacts/${m.personId}`;
  const run = (type: CardActionId) => () => onAction({ type, memberId: m.memberId });
  return (
    <div className="row wrap" style={{ justifyContent: "flex-end" }}>
      {card.actions.map((a) =>
        a.id === "openConversation" ? (
          <Link key={a.id} className={`btn btn-${a.style} btn-sm`} href={contactHref}>{l.actions[a.id]}</Link>
        ) : (
          <button key={a.id} type="button" className={`btn btn-${a.style} btn-sm`} onClick={run(a.id)}>{l.actions[a.id]}</button>
        ),
      )}
      {card.menu.length > 0 && (
        <DropdownMenu trigger={<MoreIcon className="icon" />} triggerClassName="btn btn-ghost btn-sm btn-icon" ariaLabel={l.moreActions} align="left">
          {card.menu.map((id) => (
            <Fragment key={id}>
              {id === "remove" && <div className="menu-sep" />}
              {id === "openContact" ? (
                <Link role="menuitem" className="menu-item" href={contactHref}>{l.actions[id]}</Link>
              ) : (
                <button type="button" role="menuitem" className="menu-item" onClick={run(id)}>{l.actions[id]}</button>
              )}
            </Fragment>
          ))}
        </DropdownMenu>
      )}
    </div>
  );
}

/** `selection` makes a draft card selectable for the bulk bar (the spec's "selecting rows"); a card in any other state has nothing to select. */
export type CardSelection = { selected: boolean; onToggle: () => void };

export function MemberCard({ member: m, now, labels: l, onAction, ownView, optOutPhrase = null, selection }: { member: DetailMember; now: Date; labels: SequenceLabels; onAction: OnAction; ownView: boolean; optOutPhrase?: string | null; selection?: CardSelection }) {
  const card = mapMemberCard({ state: m.state, hasDraft: m.draft !== null, holdReason: m.holdReason, reminderDueAt: m.reminderDueAt, florida: m.florida, discardReason: m.discardReason }, now);
  const name = [m.firstName, m.lastName].filter(Boolean).join(" ") || l.unnamed;
  const title = m.jobTitle?.trim() || l.noTitle;
  const parts = metaParts(m, card.kind, now, l, ownView);
  if (card.holdReason) parts.push(<strong>{l.holdPrefix} {l.holdReasons[card.holdReason]}</strong>);
  const chips = card.kind === "draft" || card.kind === "approved"
    ? [m.openIt > 0 && fill(m.openIt === 1 ? l.chipPostingsOne : l.chipPostingsMany, { n: m.openIt }), m.leadership && l.chipLeadership, m.florida && l.chipMiami].filter((c): c is string => !!c)
    : [];
  return (
    <div className="card">
      <div className="card-body row row-lg">
        {selection && card.kind === "draft" && <input type="checkbox" checked={selection.selected} onChange={selection.onToggle} aria-label={fill(l.selectMember, { name })} />}
        <Avatar id={m.personId} initials={initialsFromName(name)} />
        <div className="grow stack-sm">
          <div className="row wrap">
            <Link className="strong" href={`/contacts/${m.personId}`}>{name}</Link>
            <span className={`badge badge-${card.tone}`}>{l.badges[card.kind]}</span>
            {card.florida && <span className="badge badge-outline">{l.florida}</span>}
          </div>
          <p className="headline">
            {title}
            {m.company && <> {l.headlineAt} {m.companyKey ? <Link href={`/companies/${encodeURIComponent(m.companyKey)}`}>{m.company}</Link> : m.company}</>}
          </p>
          <div className="meta">{parts.map((p, i) => <Fragment key={i}>{i > 0 && " · "}{p}</Fragment>)}</div>
          {chips.length > 0 && <div className="row wrap row-xs">{chips.map((c) => <span key={c} className="chip">{c}</span>)}</div>}
        </div>
        <Actions card={card} m={m} l={l} onAction={onAction} />
      </div>
      {showOptOutPrompt(card.kind, optOutPhrase) && (
        <div className="card-body">
          <div className="alert alert-warn" role="note">
            <div className="grow"><span className="title">{l.optOutPromptTitle}</span> {fill(l.optOutPromptBody, { phrase: optOutPhrase ?? "" })}</div>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => onAction({ type: "optOut", memberId: m.memberId })}>{l.optOutAction}</button>
          </div>
        </div>
      )}
    </div>
  );
}

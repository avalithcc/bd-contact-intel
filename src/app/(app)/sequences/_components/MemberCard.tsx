import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { DropdownMenu } from "@/components/DropdownMenu";
import { GenerateIcon, MoreIcon } from "@/components/icons";
import { initialsFromName } from "@/components/initials";
import { ScheduleButton } from "@/components/send/ScheduleButton";
import { SendSplitButton } from "@/components/send/SendSplitButton";
import { resolveRecipientZone, zoneClock } from "@/lib/sendSchedule/zones";
import { slotOf } from "@/lib/sendSchedule/time";
import { showOptOutPrompt } from "@/lib/sequences/contactContext";
import type { DetailMember } from "@/lib/sequences/detailQueries";
import { approvedMoment, type ApprovedMoment } from "@/lib/sequences/approvedMoment";
import { mapMemberCard, type CardActionId, type CardKind, type CardView } from "@/lib/sequences/memberCard";
import { agoText, fill, miamiWhen, type SequenceLabels } from "@/lib/sequences/viewText";
import { clockLabel, whenLabel } from "@/lib/scheduledEmail/view";
import type { OnAction } from "./actions";
import { approvalSchedule, cadenceHint, type SequenceSendContext } from "./sendContext";

/** The meta line as parts, joined by " · ". The state table decides WHICH kind; this only words it from the facts. */
function metaParts(m: DetailMember, kind: CardKind, now: Date, l: SequenceLabels, ownView: boolean, moment: ApprovedMoment | null): ReactNode[] {
  const ago = (d: Date) => agoText(d, now, l);
  const parts: ReactNode[] = [];
  if (kind === "draft") {
    if (m.openIt > 0) parts.push(fill(m.openIt === 1 ? l.postingsOne : l.postingsMany, { n: m.openIt }));
    if (m.emailVerified) parts.push(<>{l.metaEmail} <span className="badge badge-verified">{l.emailVerified}</span></>);
    parts.push(m.lastContactAt ? fill(l.lastContact, { ago: ago(m.lastContactAt) }) : l.neverContacted);
  } else if (kind === "noDraft") {
    parts.push(l.noDraftYet);
  } else if (kind === "approved" || kind === "scheduled") {
    if (moment?.phase === "overdue") {
      // Its moment passed and it is still approved: the daily cap or a pre-send check is holding it; the next tick retries.
      parts.push(l.metaWaiting);
    } else if (moment && kind === "scheduled") {
      // The BD chose the moment: say it in Argentina time, and where the recipient is when we can guess.
      parts.push(<strong>{fill(l.metaScheduled, { when: whenLabel(moment.at, "argentina").replace(",", "") })} {l.metaScheduledZone}</strong>);
      const zone = resolveRecipientZone(m.place ?? {});
      if (zone) parts.push(fill(l.metaLocalAt, { place: zone.place, clock: zoneClock(moment.at, zone.zone) }));
    } else if (moment) {
      const w = miamiWhen(moment.at, now);
      const day = w.day === "today" ? l.whenToday : w.day === "tomorrow" ? l.whenTomorrow : l.whenOn;
      parts.push(<>{l.releases} {day} <strong>{w.ddmm} {l.atTime} {w.hhmm}</strong> {l.reviewMiami}</>);
      parts.push(fill(l.metaCadenceArg, { time: clockLabel(moment.at, "argentina") }));
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
  // A hand-edited draft says so on the card: the state badge cannot, and the two cards are otherwise identical.
  if (m.draft?.edited && m.draft.editedAt && (kind === "draft" || kind === "approved" || kind === "scheduled")) parts.push(<strong>{fill(ownView ? l.editedBy : l.editedByOther, { ago: ago(m.draft.editedAt) })}</strong>);
  return parts;
}

function Actions({ card, m, l, onAction, generating, send, now, moment }: { card: CardView; m: DetailMember; l: SequenceLabels; onAction: OnAction; generating: boolean; send: SequenceSendContext; now: Date; moment: ApprovedMoment | null }) {
  const contactHref = `/contacts/${m.personId}`;
  const run = (type: CardActionId) => () => void onAction({ type, memberId: m.memberId } as Parameters<OnAction>[0]);
  const name = [m.firstName, m.lastName].filter(Boolean).join(" ") || l.unnamed;
  const recipients = [{ name, zone: resolveRecipientZone(m.place ?? {}) }];
  const locked = moment?.phase === "locked";
  const lockProps = locked ? { disabled: true, title: l.lockedTitle } : {};
  return (
    <div className="row wrap" style={{ justifyContent: "flex-end" }}>
      {card.actions.map((a) => {
        if (a.id === "openConversation") return <Link key={a.id} className={`btn btn-${a.style} btn-sm`} href={contactHref}>{l.actions[a.id]}</Link>;
        if (a.id === "generate") return <button key={a.id} type="button" className={`btn btn-${a.style} btn-sm`} disabled={generating} onClick={run(a.id)}><GenerateIcon className="icon" />{generating ? l.generating : l.actions[a.id]}</button>;
        // A draft card's "Aprobar" is the split button; the reminder's stays a plain button (a reminder has no choice of moment).
        if (a.id === "approve" && card.kind === "draft") {
          return (
            <SendSplitButton
              key={a.id}
              small
              labels={send.labels}
              primaryLabel={l.reviewApproveNow}
              busy={send.busy}
              error={send.error}
              placement="down"
              schedule={approvalSchedule(send, recipients, "one")}
              cadence={{ hint: cadenceHint(now, send.schedule, l), onPick: () => void onAction({ type: "approveWith", memberId: m.memberId, when: { kind: "cadence" } }) }}
              onSendNow={() => void onAction({ type: "approveWith", memberId: m.memberId, when: { kind: "now" } })}
              onSchedule={(slot) => onAction({ type: "approveWith", memberId: m.memberId, when: { kind: "at", ...slot } })}
            />
          );
        }
        if (a.id === "change") {
          return (
            <ScheduleButton
              key={a.id}
              labels={send.labels}
              label={l.actions.change}
              className={`btn btn-${a.style} btn-sm`}
              busy={send.busy}
              error={send.error}
              {...lockProps}
              schedule={{ ...approvalSchedule(send, recipients, "one"), title: send.labels.popTitleEmail, submitLabel: send.labels.submitEmail, summary: "sumEmail", initial: moment ? slotOf(moment.at) : null }}
              onSchedule={(slot) => onAction({ type: "reschedule", memberId: m.memberId, when: { kind: "at", ...slot } })}
            />
          );
        }
        if (a.id === "sendNow") return <button key={a.id} type="button" className={`btn btn-${a.style} btn-sm`} disabled={send.busy || locked} title={locked ? l.lockedTitle : undefined} onClick={() => void onAction({ type: "reschedule", memberId: m.memberId, when: { kind: "now" } })}>{l.actions.sendNow}</button>;
        if (a.id === "cancel" || a.id === "cancelSchedule") return <button key={a.id} type="button" className="btn btn-ghost btn-sm" style={{ color: "var(--color-danger-text)" }} disabled={locked} title={locked ? l.lockedTitle : undefined} onClick={run("cancel")}>{l.actions[a.id]}</button>;
        return <button key={a.id} type="button" className={`btn btn-${a.style} btn-sm`} onClick={run(a.id)}>{l.actions[a.id]}</button>;
      })}
      {card.menu.length > 0 && (
        <DropdownMenu trigger={<MoreIcon className="icon" />} triggerClassName="btn btn-ghost btn-sm btn-icon" ariaLabel={l.moreActions}>
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

export function MemberCard({ member: m, now, labels: l, onAction, ownView, readOnly = false, optOutPhrase = null, selection, generating = false, send }: { member: DetailMember; now: Date; labels: SequenceLabels; onAction: OnAction; ownView: boolean; readOnly?: boolean; optOutPhrase?: string | null; selection?: CardSelection; generating?: boolean; send: SequenceSendContext }) {
  const moment = m.state === "approved" && m.draft ? approvedMoment(m.draft, send.schedule, now) : null;
  const card = mapMemberCard({ state: m.state, hasDraft: m.draft !== null, holdReason: m.holdReason, reminderDueAt: m.reminderDueAt, florida: m.florida, discardReason: m.discardReason, approvedMode: moment?.mode }, now, readOnly);
  const name = [m.firstName, m.lastName].filter(Boolean).join(" ") || l.unnamed;
  const title = m.jobTitle?.trim() || l.noTitle;
  const parts = metaParts(m, card.kind, now, l, ownView, moment);
  if (card.holdReason) parts.push(<strong>{l.holdPrefix} {l.holdReasons[card.holdReason]}</strong>);
  const chips = card.kind === "draft" || card.kind === "approved" || card.kind === "scheduled"
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
        <Actions card={card} m={m} l={l} onAction={onAction} generating={generating} send={send} now={now} moment={moment} />
      </div>
      {!readOnly && showOptOutPrompt(card.kind, optOutPhrase) && (
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

"use client";

import Link from "next/link";
import { ClockIcon, EditPencilIcon, WarningIcon } from "@/components/icons";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { actionsFor, sendNowDisabled, stampLabel, stateOf, wasLabel, whenLabel, type ScheduledAction, type ScheduledItem } from "@/lib/scheduledEmail/view";
import { ACTION_LABEL, type RunScheduled } from "./useScheduledActions";

const preview = (text: string) => (text.length > 120 ? `${text.slice(0, 120)}…` : text);

/** A pending scheduled email as a timeline card in "Próximas" (envio-programado.html sections 2, 4 and 5). */
export function ScheduledCard({ item, l, run, gmailConnected, now, busy }: { item: ScheduledItem; l: ContactRecordLabels; run: RunScheduled; gmailConnected: boolean; now: Date; busy: boolean }) {
  const state = stateOf(item, now);
  const first = item.personName.split(" ")[0];
  const button = (action: ScheduledAction, className: string, extra: { disabled?: boolean; title?: string } = {}) => (
    <button key={action} type="button" className={className} onClick={() => run(action, item)} disabled={busy || extra.disabled} title={extra.title}>
      {action === "edit" && <EditPencilIcon className="icon" />}
      {l[ACTION_LABEL[action]] as string}
    </button>
  );
  const ghost = (action: ScheduledAction) => button(action, "btn btn-ghost btn-sm");
  const cancel = (
    <button key="cancel" type="button" className="btn btn-ghost btn-sm btn-ghost-danger" disabled={busy} onClick={() => run("cancel", item)}>
      {l.schedActionCancel}
    </button>
  );

  if (state === "on_hold") {
    return (
      <div className="tl-item">
        <div className="tl-icon reply"><ClockIcon className="icon" /></div>
        <div className="tl-card">
          <div className="tl-head">
            <span className="what">{l.schedHoldTitle} · {item.subject}</span>
            <span className="badge badge-warn no-dot">{first} {l.schedHoldReplied}</span>
            <span className="when">{l.schedHoldWas} {whenLabel(item.sendAt, "argentina")}</span>
          </div>
          <div className="tl-body">
            {item.personName} {l.schedHoldReplied}{item.replyAt ? ` ${wasLabel(item.replyAt, now, l.schedToday)}` : ""}{item.replyText ? `: “${item.replyText}”` : ""}. {l.schedHoldBodyAfter}
          </div>
          <div className="row mt-lg">{button("sendAnyway", "btn btn-secondary btn-sm")}{ghost("edit")}{cancel}</div>
        </div>
      </div>
    );
  }
  if (state.startsWith("failed")) {
    const gmail = state === "failed_gmail";
    return (
      <div className="tl-item">
        <div className="tl-icon discard"><WarningIcon className="icon" /></div>
        <div className="tl-card">
          <div className="tl-head">
            <span className="what">{l.schedFailedTitle} · {item.subject}</span>
            <span className="badge badge-danger no-dot">{gmail ? l.schedFailedGmail : state === "failed_unconfirmed" ? l.schedFailedUnconfirmed : l.schedFailedOther}</span>
            <span className="when">{l.schedFailedWas} {wasLabel(item.sendAt, now, l.schedToday)}</span>
          </div>
          <div className="tl-body">
            {gmail ? l.schedFailedBodyGmail : state === "failed_unconfirmed" ? l.schedFailedBodyUnconfirmed : l.schedFailedBodyOther} <strong>{l.schedNoAutoSend}</strong>{l.schedFailedBodyAfter}
          </div>
          <div className="row mt-lg">
            {gmail && <Link className="btn btn-primary btn-sm" href="/account/email">{l.schedReconnect}</Link>}
            {button("sendNow", "btn btn-secondary btn-sm", sendNowDisabled(state, gmailConnected) ? { disabled: true, title: l.schedSendNowDisabled } : {})}
            {ghost("reschedule")}
            {cancel}
          </div>
        </div>
      </div>
    );
  }
  const actions = actionsFor(state);
  return (
    <div className="tl-item">
      <div className="tl-icon email"><ClockIcon className="icon" /></div>
      <div className="tl-card">
        <div className="tl-head">
          <span className="what">{l.schedCardTitle} · {item.subject}</span>
          <span className="badge badge-brand no-dot">{l.schedCardSends} {whenLabel(item.sendAt, "argentina")}</span>
          <span className="when">{l.schedCardBy} {item.actorName} {l.schedCardOn} {stampLabel(item.createdAt)}</span>
        </div>
        <div className="tl-body">
          {l.schedCardTo} {item.toAddress}. “{preview(item.body)}” <span className="meta">{l.schedCardInMiami} {whenLabel(item.sendAt, "miami")}.</span>
        </div>
        {actions.length ? (
          <div className="row mt-lg">
            {button("edit", "btn btn-secondary btn-sm")}
            {ghost("changeTime")}
            {ghost("sendNow")}
            {cancel}
          </div>
        ) : (
          <p className="meta mt-lg">{l.schedLocked}</p>
        )}
      </div>
    </div>
  );
}

/** The system line a cancellation leaves behind (envio-programado.html section 2). */
export function CancelledLine({ item, l }: { item: ScheduledItem; l: ContactRecordLabels }) {
  return (
    <div className="tl-item">
      <div className="tl-icon system"><ClockIcon className="icon" /></div>
      <div className="tl-card system">
        <div className="tl-head">
          <span className="what">{l.schedCancelledWhat} · {item.subject}</span>
          <span className="when">{item.cancelledAt ? stampLabel(item.cancelledAt) : ""} · {item.actorName}</span>
        </div>
        <div className="tl-body">{l.schedCancelledWas} {whenLabel(item.sendAt, "argentina")}. {l.schedCancelledBodyAfter}</div>
      </div>
    </div>
  );
}

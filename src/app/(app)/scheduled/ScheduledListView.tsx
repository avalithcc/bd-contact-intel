"use client";

import Link from "next/link";
import { DropdownMenu } from "@/components/DropdownMenu";
import { ClockIcon, MoreIcon, WarningIcon } from "@/components/icons";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { actionsFor, clockLabel, sendNowDisabled, stateOf, wasLabel, whenLabel, type ScheduledItem, type ScheduledState } from "@/lib/scheduledEmail/view";
import { ACTION_LABEL, useNow, useScheduledActions } from "./useScheduledActions";

const STATE_BADGE: Record<ScheduledState, { className: string; label: keyof ContactRecordLabels }> = {
  scheduled: { className: "badge badge-brand", label: "schedStateScheduled" },
  locked: { className: "badge badge-brand", label: "schedStateLocked" },
  on_hold: { className: "badge badge-warn", label: "schedStateOnHold" },
  failed_gmail: { className: "badge badge-danger", label: "schedStateFailedGmail" },
  failed_unconfirmed: { className: "badge badge-danger", label: "schedStateFailedUnconfirmed" },
  failed_other: { className: "badge badge-danger", label: "schedStateFailedOther" },
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The "Programados" screen (envio-programado.html section 3): a red banner when Gmail died, then the table. */
export function ScheduledListView({ items, labels: l, gmailConnected, now: serverNow }: { items: ScheduledItem[]; labels: ContactRecordLabels; gmailConnected: boolean; now: Date }) {
  const { run, dialogs, busy } = useScheduledActions(l);
  const now = useNow(serverNow);
  const failedGmail = items.filter((i) => stateOf(i, now) === "failed_gmail");
  return (
    <>
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{l.schedPageEyebrow}</div>
          <h1>{l.schedPageTitle}<span className="dot">.</span></h1>
          <p className="meta">{l.schedPageIntro} <strong>{l.schedPageOnlyYours}</strong>. {l.schedPageHours}</p>
        </div>
      </div>
      {failedGmail.length > 0 && !gmailConnected && (
        <div className="alert alert-danger mb-lg">
          <WarningIcon className="icon" />
          <div>
            <span className="title">{l.schedBannerTitle}</span> {failedGmail.length === 1 ? l.schedBannerOne : `${l.schedBannerHave} ${failedGmail.length} ${l.schedBannerMany}`}{" "}
            <Link href={`/contacts/${failedGmail[0]!.personId}#scheduled-emails`}>{l.schedBannerWhat}</Link>{" "}
            <Link className="btn btn-secondary btn-sm" href="/account/email">{l.schedReconnect}</Link>
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="empty-icon"><ClockIcon className="icon icon-lg" /></div>
          <p>{l.schedEmpty}</p>
        </div></div>
      ) : (
        <div className="table-wrap"><table className="data">
          <thead><tr>
            <th>{l.schedColContact}</th><th>{l.schedColSubject}</th><th className="sorted">{l.schedColSends} <span className="sort">↑</span></th><th>{l.schedColStatus}</th>
            <th><span className="sr-only">{l.schedColActions}</span></th>
          </tr></thead>
          <tbody>
            {items.map((item) => {
              const state = stateOf(item, now);
              const badge = STATE_BADGE[state];
              const failed = state.startsWith("failed");
              const actions = actionsFor(state);
              return (
                <tr key={item.id}>
                  <td><div className="stack-sm"><Link className="strong" href={`/contacts/${item.personId}#scheduled-emails`}>{item.personName}</Link>{item.company && <div className="meta">{item.company}</div>}</div></td>
                  <td>
                    {item.subject}
                    {(item.attachments.length > 0 || item.otherRecipients.length > 0) && (
                      <div className="meta">
                        {item.otherRecipients.length > 0 && <>{item.otherRecipients.length + 1} {l.emailRecipientsCount}</>}
                        {item.otherRecipients.length > 0 && item.attachments.length > 0 && " · "}
                        {item.attachments.length > 0 && <>{item.attachments.length} {item.attachments.length === 1 ? l.attachmentsFileOne : l.attachmentsFileMany}</>}
                      </div>
                    )}
                  </td>
                  <td className="nowrap">
                    {failed ? (
                      <><span className="strong">{l.schedFailedTitle}</span><div className="meta">{l.schedWasPrefix} {wasLabel(item.sendAt, now, l.schedToday)}</div></>
                    ) : (
                      <><span className="strong">{capitalize(whenLabel(item.sendAt, "argentina"))}</span><div className="meta">{l.schedMiamiPrefix} {clockLabel(item.sendAt, "miami")}</div></>
                    )}
                  </td>
                  <td><span className={badge.className}>{l[badge.label] as string}</span></td>
                  <td className="right">
                    {actions.length > 0 && (
                      <DropdownMenu trigger={<MoreIcon className="icon" />} triggerClassName="btn btn-ghost btn-sm btn-icon" ariaLabel={`${l.schedMoreActions} ${item.personName}`}>
                        {actions.map((action) => (
                          <button
                            key={action}
                            type="button"
                            role="menuitem"
                            className="menu-item"
                            disabled={busy || (action === "sendNow" && sendNowDisabled(state, gmailConnected))}
                            title={action === "sendNow" && sendNowDisabled(state, gmailConnected) ? l.schedSendNowDisabled : undefined}
                            onClick={() => run(action, item)}
                          >
                            {l[ACTION_LABEL[action]] as string}
                          </button>
                        ))}
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="table-footer"><span>{items.length === 1 ? l.schedFooterOne : `${items.length} ${l.schedFooterMany}`}</span><span>{l.schedFooterOrder}</span></div></div>
      )}
      {dialogs}
    </>
  );
}

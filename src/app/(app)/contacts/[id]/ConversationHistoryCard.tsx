"use client";

import { LockIcon } from "@/components/icons";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { OwnConversationHistory } from "./OwnConversationHistory";

export interface LockedConversationSummaryView {
  bdId: string;
  bdName: string;
  summaryText: string;
}

export interface OwnConversationRow {
  bdName: string;
  summaryText: string;
}

/**
 * Right-rail "Historial de conversaciones" card (contact-record.html:
 * 172-178; admin-conversation-access mockup, admin-conversation.html:
 * 138-144) — ONE card merging both restorations, not two adjacent cards
 * (owner decision 2026-09-30):
 *
 *  - `ownRow` — the viewing BD's own connection with this Contact, for
 *    EVERY viewer (admin or not): count + last message date, opening the
 *    shared `ConversationDialog` on demand (`OwnConversationHistory`).
 *  - `summaries` — every OTHER BD with conversation content (email thread(s),
 *    LinkedIn message history, or both), ADMIN-ONLY, as a plain summary: the
 *    content itself is already inline in the timeline (owner decision
 *    2026-10-15), so there is no action here.
 *  - `lockedRows` — every OTHER BD with real LinkedIn message history, for a
 *    NON-admin viewer: name + count/date, no content, no action (bugfix
 *    2026-09-30 — this card used to render nothing at all here, while the
 *    interleaved "Todo" timeline already showed a locked marker for the
 *    exact same connection; spec: "non-admins MAY see which BDs have
 *    history..., never the content").
 */
export function ConversationHistoryCard({
  personId,
  personName,
  ownRow,
  summaries,
  lockedRows,
  labels: l,
}: {
  personId: string;
  personName: string;
  ownRow: OwnConversationRow | null;
  summaries: LockedConversationSummaryView[];
  lockedRows: LockedConversationSummaryView[];
  labels: ContactRecordLabels;
}) {
  if (!ownRow && summaries.length === 0 && lockedRows.length === 0) return null;

  const mentionedNames = [
    ownRow?.bdName,
    ...summaries.map((s) => s.bdName),
    ...lockedRows.map((s) => s.bdName),
  ].filter((name): name is string => Boolean(name));

  return (
    <div className="card assoc">
      <div className="card-header">
        <h3>{l.conversationHistoryTitle}</h3>
      </div>
      <div className="card-body">
        <p className="small">
          {l.conversationHistoryIntroPrefix} {mentionedNames.join(", ")}.
        </p>

        {ownRow && (
          <OwnConversationHistory
            personId={personId}
            bdName={ownRow.bdName}
            summaryText={ownRow.summaryText}
            dialogTitle={`${l.conversationDialogTitlePrefix} ${personName}`}
            showMessagesLabel={l.timelineShowMessages}
            noContentLabel={l.adminNoConversationContent}
            genericErrorLabel={l.genericError}
            emptyValue={l.emptyValue}
            sentBadgeLabel={l.timelineSentBadge}
            receivedBadgeLabel={l.timelineReceivedBadge}
          />
        )}

        {summaries.map((s) => (
          <div key={s.bdId} className="assoc-row">
            <div className="grow">
              <div className="n">{s.bdName}</div>
              <div className="s">{s.summaryText}</div>
            </div>
          </div>
        ))}

        {lockedRows.map((s) => (
          <div key={s.bdId} className="assoc-row">
            <div className="grow">
              <div className="n">{s.bdName}</div>
              <div className="s">{s.summaryText}</div>
            </div>
            <span className="meta">
              <LockIcon className="icon" />
            </span>
          </div>
        ))}

        <p className="meta mt-lg">
          {summaries.length > 0 ? l.conversationHistoryAdminFooter : l.conversationHistoryPrivateFooter}
        </p>
      </div>
    </div>
  );
}

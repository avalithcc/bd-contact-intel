"use client";

import { useState } from "react";
import { EyeIcon } from "@/components/icons";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { AdminViewConversationDialog } from "./AdminViewConversationDialog";
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
 *    EVERY viewer (admin or not): count + last message date, expandable to
 *    the full message history (`OwnConversationHistory`, on-demand fetch).
 *  - `summaries` — every OTHER BD with locked content (email thread(s),
 *    LinkedIn message history, or both — the destination route is
 *    (contact, BD)-scoped, admin-conversation-access README decision 4, so
 *    one row per BD covers every channel), ADMIN-ONLY. A non-admin sees
 *    nothing here for another BD's connection — not even a bare lock icon —
 *    matching the admin-conversation-access precedent this card now shares
 *    its single instance with. Each row's "Ver" reuses the SAME confirmation
 *    dialog the per-row action in Timeline.tsx opens (README "all three
 *    navigate to the same destination"); this card owns its own dialog
 *    instance rather than sharing Timeline's state, since the two live in
 *    separate parts of the server-rendered page tree.
 */
export function ConversationHistoryCard({
  personId,
  personName,
  ownRow,
  summaries,
  labels: l,
}: {
  personId: string;
  personName: string;
  ownRow: OwnConversationRow | null;
  summaries: LockedConversationSummaryView[];
  labels: ContactRecordLabels;
}) {
  const [pending, setPending] = useState<{ bdId: string; bdName: string } | null>(null);

  if (!ownRow && summaries.length === 0) return null;

  const mentionedNames = [ownRow?.bdName, ...summaries.map((s) => s.bdName)].filter(
    (name): name is string => Boolean(name),
  );

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
            showMessagesLabel={l.timelineShowMessages}
            hideMessagesLabel={l.timelineHideMessages}
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
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setPending({ bdId: s.bdId, bdName: s.bdName })}
            >
              <EyeIcon className="icon" />
              {l.conversationHistoryViewAction}
            </button>
          </div>
        ))}

        <p className="meta mt-lg">
          {summaries.length > 0 ? l.conversationHistoryAdminFooter : l.conversationHistoryPrivateFooter}
        </p>
      </div>

      {pending && (
        <AdminViewConversationDialog
          open
          onClose={() => setPending(null)}
          personId={personId}
          personName={personName}
          bdId={pending.bdId}
          bdName={pending.bdName}
          labels={l}
        />
      )}
    </div>
  );
}

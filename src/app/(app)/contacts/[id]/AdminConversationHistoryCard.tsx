"use client";

import { useState } from "react";
import { EyeIcon } from "@/components/icons";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { AdminViewConversationDialog } from "./AdminViewConversationDialog";

export interface LockedConversationSummaryView {
  bdId: string;
  bdName: string;
  summaryText: string;
}

/**
 * Right-rail "Historial de conversaciones" card, admin-only
 * (admin-conversation-access mockup, admin-conversation.html:138-144). The
 * mockup's own "Ver" link per BD reuses the SAME confirmation dialog the
 * per-row action in Timeline.tsx opens (README "all three navigate to the
 * same destination") — this card owns its own dialog instance rather than
 * sharing Timeline's state, since the two live in separate parts of the
 * server-rendered page tree; either entry point ends on the identical
 * `/contacts/[id]/conversation/[bdId]` route.
 */
export function AdminConversationHistoryCard({
  personId,
  personName,
  summaries,
  labels: l,
}: {
  personId: string;
  personName: string;
  summaries: LockedConversationSummaryView[];
  labels: ContactRecordLabels;
}) {
  const [pending, setPending] = useState<{ bdId: string; bdName: string } | null>(null);

  if (summaries.length === 0) return null;

  return (
    <div className="card assoc">
      <div className="card-header">
        <h3>{l.conversationHistoryTitle}</h3>
      </div>
      <div className="card-body">
        <p className="small">
          {l.conversationHistoryIntroPrefix} {summaries.map((s) => s.bdName).join(", ")}.
        </p>
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
        <p className="meta mt-lg">{l.conversationHistoryAdminFooter}</p>
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

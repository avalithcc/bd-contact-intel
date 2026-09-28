// Intentionally unreferenced for now. This was rendered by Timeline.tsx's
// LinkedIn conversation card, which is hidden while LinkedIn ingestion is off
// (2026-09-28). The component, its route
// (/contacts/[id]/conversation/[bdId]) and the audit trail all still work —
// restore the render in Timeline.tsx to bring it back. See
// openspec/BACKLOG.md, "admin-email-conversation-access".

"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { WarningIcon } from "@/components/icons";
import { revealAdminConversationAction } from "../actions";
import type { AdminConversationData } from "@/lib/activity/getConversationForAdmin";

/**
 * Admin's inline "Ver conversación" reveal (mockup-port r04; contact-record-
 * admin.html:130 `.alert.alert-audit` banner + the thread it introduces).
 * Renders the "Ver conversación" button; once clicked, calls the audited
 * `revealAdminConversationAction` (goes through the SAME `audit_log` write
 * `/contacts/[id]/conversation/[bdId]` always used) and swaps in the banner
 * + thread inline — no navigation. The deep-link page stays reachable via
 * the "Abrir en una página" link alongside the reveal button.
 */
export function AdminConversationReveal({
  personId,
  bdId,
  auditAlertBody,
  labels: l,
}: {
  personId: string;
  bdId: string;
  // Pre-composed server-side (page.tsx has the full, non-ClientStrings
  // `dict.contactRecordServer` this needs to interpolate `bdName` — see the
  // comment on `contactRecordServer` in dictionaries/es.ts for why that
  // template can't live on `labels` here).
  auditAlertBody: string;
  labels: ContactRecordLabels;
}) {
  const [data, setData] = useState<AdminConversationData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  if (data) {
    return (
      <>
        <div className="alert alert-audit mt-lg">
          <WarningIcon className="icon" />
          <div>
            <div className="title">{l.adminAuditAlertTitle}</div>
            {auditAlertBody}
          </div>
        </div>
        <div className="thread">
          {data.emailEntries.map((e) => (
            <div key={e.id} className="thread-msg">
              <div>
                <span className="from">{l.timelineFilterEmail}</span>
                <div className="snippet">
                  {typeof e.metadata?.subject === "string" ? e.metadata.subject : null}
                </div>
              </div>
              <span className="meta">{format(e.createdAt, "d MMM", { locale: es })}</span>
            </div>
          ))}
          {data.linkedin.flatMap((thread) =>
            thread.messages.map((m) => (
              <div key={m.id} className="thread-msg">
                <div>
                  <span className="from">{m.senderName ?? "—"}</span>
                  <div className="snippet">{m.content}</div>
                </div>
                <span className="meta">{format(m.sentAt, "d MMM", { locale: es })}</span>
              </div>
            )),
          )}
          {data.emailEntries.length === 0 && data.linkedin.every((t) => t.messages.length === 0) && (
            <div className="thread-msg">{l.adminNoConversationContent}</div>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="row mt-lg">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          const result = await revealAdminConversationAction(personId, bdId);
          setBusy(false);
          if (result.ok) {
            setData(result.data);
          } else {
            setError(true);
          }
        }}
      >
        {l.viewConversationLink} ({l.viewConversationAuditHint})
      </button>
      <Link href={`/contacts/${personId}/conversation/${bdId}`} className="btn btn-ghost btn-sm">
        {l.adminOpenAsPage}
      </Link>
      {error && (
        <span className="error-text" role="alert">
          {l.genericError}
        </span>
      )}
    </div>
  );
}

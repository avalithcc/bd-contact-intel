"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { WarningIcon } from "@/components/icons";
import { ConversationDialog } from "@/components/ConversationDialog";
import { EmailThreadMessage } from "@/components/EmailThreadMessage";
import { groupSyncedEmailThreads } from "@/lib/gmail/groupSyncedEmailThreads";
import { sortMessagesChronologically } from "@/lib/activity/conversationMessageOrder";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import type { AdminConversationData } from "@/lib/activity/getConversationForAdmin";
import { revealAdminConversationAction } from "../actions";
import { AdminViewConversationDialog } from "./AdminViewConversationDialog";

function when(at: Date): string {
  return format(at, "d MMM, HH:mm", { locale: es });
}

export interface AdminConversationTrigger {
  bdId: string;
  bdName: string;
}

/**
 * Confirm -> audited fetch -> content, as ONE mounted instance (owner
 * decision 2026-09-30: the SAME shared modal for every "Ver conversación"
 * entry point — ConversationHistoryCard's own row, Timeline's per-locked-row
 * action, and the audit log's "Abrir" link via AdminConversationAutoOpen).
 *
 * `revealAdminConversationAction` (src/app/(app)/contacts/actions.ts) is the
 * SAME action the old (now-deleted) `AdminConversationReveal.tsx` used:
 * `requireAdmin()` then `getConversationForAdmin`, which writes the
 * `audit_log(view_conversation)` row BEFORE reading content, in the same
 * transaction — exactly the audit guarantee the old standalone page relied
 * on, now triggered by "Ver conversación" instead of a page navigation.
 * Exactly one audit row lands per confirmed view: this effect only ever
 * fires once per mounted instance (`phase` only enters "loading" once, from
 * either the confirm click or `skipConfirm`), and callers key a fresh
 * instance per trigger (`key={bdId}`) so a different row's click can never
 * reuse an in-flight fetch.
 *
 * `skipConfirm` (the audit log's own "Abrir" link — AdminConversationAutoOpen.tsx)
 * starts straight in "loading": clicking "Abrir" from an already-audited log
 * entry IS the confirmation, so a second one here would only add friction,
 * not real gating (the admin check still happens server-side inside the
 * action either way, and this component only ever mounts when page.tsx has
 * already verified `isAdmin`).
 */
export function AdminConversationFlow({
  trigger,
  skipConfirm = false,
  onClose,
  personId,
  personName,
  labels: l,
}: {
  trigger: AdminConversationTrigger;
  skipConfirm?: boolean;
  onClose: () => void;
  personId: string;
  personName: string;
  labels: ContactRecordLabels;
}) {
  const [phase, setPhase] = useState<"confirm" | "loading" | "ready" | "error">(
    skipConfirm ? "loading" : "confirm",
  );
  const [data, setData] = useState<AdminConversationData | null>(null);

  useEffect(() => {
    if (phase !== "loading") return;
    let cancelled = false;
    revealAdminConversationAction(personId, trigger.bdId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setPhase("error");
        return;
      }
      setData(result.data);
      setPhase("ready");
    });
    return () => {
      cancelled = true;
    };
    // Fires once per mounted instance, the moment `phase` first becomes
    // "loading" — `personId`/`trigger.bdId` are stable for this instance's
    // whole lifetime (parents remount a fresh instance per `key={bdId}`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === "confirm") {
    return (
      <AdminViewConversationDialog
        open
        onClose={onClose}
        onConfirm={() => setPhase("loading")}
        busy={false}
        personName={personName}
        bdName={trigger.bdName}
        labels={l}
      />
    );
  }

  const targetBdName = data?.targetBdName ?? trigger.bdName;
  const title = `${l.conversationDialogTitlePrefix} ${targetBdName}`;
  const syncedThreads = data ? groupSyncedEmailThreads(data.syncedEmails) : [];
  const linkedinMessages = data ? data.linkedin.flatMap((t) => sortMessagesChronologically(t.messages)) : [];

  return (
    <ConversationDialog
      open
      onClose={onClose}
      title={title}
      loading={phase === "loading"}
      error={phase === "error"}
      errorLabel={l.genericError}
      banner={
        data && (
          <div className="alert alert-audit">
            <WarningIcon className="icon" />
            <div>
              <div className="title">
                {l.adminAuditBannerPrefix} {data.targetBdName} {l.adminAuditBannerSuffix}
              </div>
            </div>
          </div>
        )
      }
    >
      <section>
        <h3 className="section-title">{l.adminSyncedEmailSectionTitle}</h3>
        {syncedThreads.length > 0 ? (
          <div className="thread">
            {syncedThreads.map((thread) =>
              thread.messages.map((m) => {
                const isSent = m.direction === "outbound";
                return (
                  <EmailThreadMessage
                    key={m.id}
                    avatarId={isSent ? trigger.bdId : personId}
                    senderName={isSent ? targetBdName : personName}
                    isSent={isSent}
                    sentLabel={l.timelineSentBadge}
                    receivedLabel={l.timelineReceivedBadge}
                    when={when(m.sentAt)}
                    recipientPrefix={l.timelineRecipientPrefix}
                    recipientText={null}
                    bodyText={m.bodyText ?? ""}
                    bodyTruncated={m.bodyTruncated}
                    bodyTruncatedNote={l.timelineBodyTruncatedNote}
                  />
                );
              }),
            )}
          </div>
        ) : (
          <p className="meta">{l.adminNoSyncedEmailContent}</p>
        )}
      </section>

      {data && data.emailEntries.length > 0 && (
        <section className="mt-lg">
          <h3 className="section-title">{l.adminLegacyEmailSectionTitle}</h3>
          <div className="thread">
            {data.emailEntries.map((e) => (
              <div key={e.id} className="thread-msg">
                <div>
                  <span className="from">
                    {typeof e.metadata?.subject === "string" ? e.metadata.subject : l.timelineSystemActor}
                  </span>
                  <div className="snippet">{typeof e.metadata?.body === "string" ? e.metadata.body : ""}</div>
                </div>
                <span className="meta">{when(e.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-lg">
        <h3 className="section-title">{l.adminLinkedinSectionTitle}</h3>
        {linkedinMessages.length > 0 ? (
          <div className="thread">
            {linkedinMessages.map((m) => (
              <div key={m.id} className="thread-msg">
                <span className="avatar avatar-sm" aria-hidden="true">
                  {(m.senderName ?? "—").slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <div className="thread-msg-head">
                    <span className="from">{m.senderName ?? l.timelineSystemActor}</span>
                    <span className="when">{when(m.sentAt)}</span>
                  </div>
                  <div className="snippet">{m.content}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="meta">{l.adminNoLinkedinContent}</p>
        )}
      </section>
    </ConversationDialog>
  );
}

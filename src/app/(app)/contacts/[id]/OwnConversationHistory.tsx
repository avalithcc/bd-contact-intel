"use client";

import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { EyeIcon } from "@/components/icons";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { ConversationDialog } from "@/components/ConversationDialog";
import { sortMessagesChronologically } from "@/lib/activity/conversationMessageOrder";
import { getOwnConversationMessagesAction } from "./ownConversationActions";
import type { OwnConversationMessage } from "@/lib/activity/getOwnConversationMessages";

/**
 * The viewing BD's own row inside the right panel's "Historial de
 * conversaciones" card (owner decision 2026-09-30; contact-record.html:
 * 172-178) — count + last message date are already on screen (page.tsx,
 * from `record.connections`, no extra query). "Ver mensajes" opens the
 * shared `ConversationDialog` (same modal the admin bypass uses,
 * AdminConversationFlow.tsx) instead of expanding inline in the narrow
 * sidebar column (owner complaint 2026-09-30: an inline expansion here was
 * an endless vertical scroll in a narrow column). Content is fetched on
 * demand (getOwnConversationMessagesAction) the first time the dialog opens
 * — never during the record page's own render — and cached for the life of
 * this mount, so reopening doesn't refetch. Every OTHER BD's connection
 * renders as a plain locked row directly in ConversationHistoryCard.tsx —
 * this component only ever mounts for the viewer's OWN connection.
 */
export function OwnConversationHistory({
  personId,
  bdName,
  summaryText,
  dialogTitle,
  showMessagesLabel,
  noContentLabel,
  genericErrorLabel,
  emptyValue,
  sentBadgeLabel,
  receivedBadgeLabel,
}: {
  personId: string;
  bdName: string;
  summaryText: string;
  // Precomposed by ConversationHistoryCard (`${conversationDialogTitlePrefix}
  // ${personName}`) — the modal is titled by the CONTACT (the counterpart of
  // this BD's own conversation), not by `bdName` (the viewer's own name,
  // shown on the row itself so every BD with history is listed the same
  // way — see that card's own doc comment).
  dialogTitle: string;
  showMessagesLabel: string;
  noContentLabel: string;
  genericErrorLabel: string;
  emptyValue: string;
  sentBadgeLabel: string;
  receivedBadgeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<OwnConversationMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  function openDialog() {
    setOpen(true);
    if (messages !== null) return;
    setLoading(true);
    setError(false);
    getOwnConversationMessagesAction(personId)
      .then((result) => {
        setLoading(false);
        if (!result.ok) {
          setError(true);
          return;
        }
        setMessages(sortMessagesChronologically(result.messages));
      })
      .catch(() => {
        setLoading(false);
        setError(true);
      });
  }

  return (
    <div className="assoc-row">
      <div className="grow">
        <div className="n">{bdName}</div>
        <div className="s">{summaryText}</div>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={openDialog}>
        <EyeIcon className="icon" />
        {showMessagesLabel}
      </button>

      <ConversationDialog
        open={open}
        onClose={() => setOpen(false)}
        title={dialogTitle}
        loading={loading}
        error={error}
        errorLabel={genericErrorLabel}
      >
        {messages && messages.length === 0 ? (
          <p className="meta">{noContentLabel}</p>
        ) : (
          <div className="thread">
            {messages?.map((m) => (
              <div key={m.id} className="thread-msg">
                <Avatar
                  id={m.id}
                  initials={initialsFromName(m.senderName ?? emptyValue)}
                  variant={m.direction === "sent" ? "bd" : "circle"}
                  size="sm"
                />
                <div>
                  <div className="thread-msg-head">
                    <span className="who">
                      <span className="from">{m.senderName ?? emptyValue}</span>
                      <span className={m.direction === "sent" ? "badge badge-info no-dot" : "badge badge-success no-dot"}>
                        {m.direction === "sent" ? sentBadgeLabel : receivedBadgeLabel}
                      </span>
                    </span>
                    <span className="when">{format(m.sentAt, "d MMM", { locale: es })}</span>
                  </div>
                  {/* Rendered as text, never HTML — imported LinkedIn message content is untrusted free text. */}
                  <div className="snippet">{m.content}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ConversationDialog>
    </div>
  );
}

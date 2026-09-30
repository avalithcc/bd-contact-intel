"use client";

import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronDownIcon } from "@/components/icons";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { getOwnConversationMessagesAction } from "./ownConversationActions";
import type { OwnConversationMessage } from "@/lib/activity/getOwnConversationMessages";

/**
 * The viewing BD's own row inside the right panel's "Historial de
 * conversaciones" card (owner decision 2026-09-30; contact-record.html:
 * 172-178) — count + last message date are already on screen (page.tsx,
 * from `record.connections`, no extra query); this only adds the
 * expandable FULL message history, fetched on demand
 * (getOwnConversationMessagesAction) the first time it's expanded, never
 * during the record page's own render. Every OTHER BD's connection renders
 * as a plain locked row directly in page.tsx — this component only ever
 * mounts for the viewer's OWN connection.
 */
export function OwnConversationHistory({
  personId,
  bdName,
  summaryText,
  showMessagesLabel,
  hideMessagesLabel,
  noContentLabel,
  genericErrorLabel,
  emptyValue,
  sentBadgeLabel,
  receivedBadgeLabel,
}: {
  personId: string;
  bdName: string;
  summaryText: string;
  showMessagesLabel: string;
  hideMessagesLabel: string;
  noContentLabel: string;
  genericErrorLabel: string;
  emptyValue: string;
  sentBadgeLabel: string;
  receivedBadgeLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<OwnConversationMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
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
        setMessages(result.messages);
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
        {expanded && (
          <div className="thread mt-lg">
            {loading ? (
              <div className="thread-msg">
                <span className="avatar avatar-sm" aria-hidden="true" />
                <div>
                  <div className="skeleton" style={{ width: "90%" }} />
                  <div className="skeleton mt-2xs" style={{ width: "60%" }} />
                </div>
              </div>
            ) : error ? (
              <div className="thread-msg">
                <span className="error-text" role="alert">
                  {genericErrorLabel}
                </span>
              </div>
            ) : messages && messages.length === 0 ? (
              <div className="thread-msg">{noContentLabel}</div>
            ) : (
              // `.thread-msg`'s grid is avatar (22px) | content (design-system.css)
              // — same shape Timeline.tsx's own renderThreadMessage uses, NOT the
              // dormant 3-column `avatar | snippet | meta` markup
              // AdminConversationReveal.tsx (unreferenced, see that file's own
              // doc comment) used to have; design-system.css explicitly flags
              // that shape as stale for whoever restores this.
              messages?.map((m) => (
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
              ))
            )}
          </div>
        )}
      </div>
      <button type="button" className="btn btn-ghost btn-sm" aria-expanded={expanded} onClick={toggle}>
        <ChevronDownIcon className="icon" />
        {expanded ? hideMessagesLabel : showMessagesLabel}
        {loading && <span className="spinner" aria-hidden="true" />}
      </button>
    </div>
  );
}

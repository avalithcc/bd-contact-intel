"use client";

import { useEffect, useRef } from "react";
import { Dialog } from "@/components/Dialog";

/**
 * Shared conversation viewer modal (owner decision 2026-09-30) — the ONE
 * dialog the viewing BD's own LinkedIn history (OwnConversationHistory.tsx)
 * renders into, replacing the old inline sidebar expansion. (The admin's
 * view of other BDs' conversations is inline in the timeline since
 * 2026-10-15 and no longer uses a dialog.)
 *
 * The base `.dialog` caps its own height to the viewport and scrolls
 * `.dialog-body` (globals.css). `.dialog-body-scroll` makes THIS wrapper the
 * scroll container instead (via `.dialog-body:has(> .dialog-body-scroll)`),
 * because the effect below scrolls it to the bottom programmatically.
 *
 * Once `loading` turns false with real content ready, the scroll container
 * is scrolled to its own bottom — chat convention: land on the most recent
 * message, not the top of the thread.
 */
export function ConversationDialog({
  open,
  onClose,
  title,
  loading,
  error,
  errorLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  loading: boolean;
  error: boolean;
  errorLabel: string;
  children: React.ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Depends on `open` too (bugfix, caught via the screenshot probe): the
  // underlying `<Dialog>` unmounts its body entirely while closed (returns
  // `null`), so the scroll container is a FRESH DOM node every time the
  // dialog reopens — reopening with already-cached content (no `loading`
  // transition, since a cache hit never sets `loading` back to `true`) would
  // otherwise land on scrollTop 0 instead of the newest message.
  useEffect(() => {
    if (!open || loading || error) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, loading, error]);

  return (
    <Dialog open={open} onClose={onClose} title={title} wide>
      <div ref={bodyRef} className="dialog-body-scroll">
        {loading ? (
          <div className="thread-msg">
            <span className="avatar avatar-sm" aria-hidden="true" />
            <div>
              <div className="skeleton" style={{ width: "90%" }} />
              <div className="skeleton mt-2xs" style={{ width: "60%" }} />
            </div>
          </div>
        ) : error ? (
          <span className="error-text" role="alert">
            {errorLabel}
          </span>
        ) : (
          children
        )}
      </div>
    </Dialog>
  );
}

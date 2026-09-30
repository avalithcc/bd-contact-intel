"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { boardDropAction, isBoardStatus, isBoardDropAction, type BoardDropAction } from "@/lib/contacts/board";
import { Dialog } from "@/components/Dialog";
import { logContactMeetingAction, discardContactAction } from "./actions";
import { contactActionErrorMessage, type ContactRecordLabels } from "@/lib/contacts/labels";
import { MeetingForm, DiscardForm, type ActionError } from "./[id]/QuickActions";

export interface BoardMoveConfirmLabels {
  titlePrefix: string;
  body: string;
  confirm: string;
  cancel: string;
}

interface PendingMove {
  personId: string;
  action: BoardDropAction;
  targetLabel: string;
  /** Only used for actions other than meeting/discard (currently just
   * "email") — those still navigate to the record page's quick-action
   * composer, unchanged. */
  href: string;
}

type ActiveForm = { kind: "meeting" | "discard"; personId: string } | null;

/**
 * Drag-and-drop progressive enhancement for the Contacts board (task 14.1,
 * 10.5; mockup-parity 4.3 move-confirm dialog; contacts-board.html:93-121
 * log-meeting/discard dialogs). Dropping a card on "Reunión" or
 * "Descartado" (or picking either from a card's "Mover a..." menu) shows a
 * confirm step, then opens the SAME quick-action composer the record page
 * uses (`MeetingForm`/`DiscardForm`, exported from `[id]/QuickActions.tsx`
 * to avoid duplicating ~90 lines of form markup) — calling
 * `logContactMeetingAction`/`discardContactAction` directly, INLINE on the
 * board, never leaving `/contacts?layout=board`. Any other drop target
 * (currently just "Contactado" -> "email") still navigates to
 * `/contacts/[id]?openAction=email` — only log-meeting/discard were asked
 * to become inline dialogs; the record page's email composer needs the
 * contact's full email address/history context this board card doesn't
 * carry, so it's out of scope here.
 */
export function BoardDnD({
  children,
  labels,
  recordLabels,
}: {
  children: ReactNode;
  labels: BoardMoveConfirmLabels;
  recordLabels: ContactRecordLabels;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [activeForm, setActiveForm] = useState<ActiveForm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function onDragStart(e: DragEvent) {
      const card = (e.target as HTMLElement).closest<HTMLElement>("[data-person-id]");
      if (!card || !e.dataTransfer) return;
      e.dataTransfer.setData("text/plain", card.dataset.personId!);
      e.dataTransfer.effectAllowed = "move";
    }

    function onDragOver(e: DragEvent) {
      const col = (e.target as HTMLElement).closest<HTMLElement>("[data-board-status]");
      const status = col?.dataset.boardStatus;
      if (status && isBoardStatus(status) && boardDropAction(status)) {
        e.preventDefault();
      }
      autoScrollBoard(e);
    }

    // Small progressive enhancement: a board wider than the viewport
    // (fix/board-horizontal-scroll) can start a column entirely
    // scrolled off-screen — nudge `.board`'s own scroll position while
    // dragging near its left/right edge so a column doesn't have to
    // already be visible to be a drop target.
    const EDGE_PX = 56;
    const SCROLL_STEP_PX = 24;
    function autoScrollBoard(e: DragEvent) {
      const board = root!.querySelector<HTMLElement>(".board");
      if (!board) return;
      const rect = board.getBoundingClientRect();
      if (e.clientX < rect.left + EDGE_PX) {
        board.scrollLeft -= SCROLL_STEP_PX;
      } else if (e.clientX > rect.right - EDGE_PX) {
        board.scrollLeft += SCROLL_STEP_PX;
      }
    }

    function onDrop(e: DragEvent) {
      const col = (e.target as HTMLElement).closest<HTMLElement>("[data-board-status]");
      const status = col?.dataset.boardStatus;
      const personId = e.dataTransfer?.getData("text/plain");
      if (!status || !personId || !isBoardStatus(status)) return;
      const action = boardDropAction(status);
      if (!action) return;
      e.preventDefault();
      setPendingMove({
        personId,
        action,
        href: `/contacts/${personId}?openAction=${action}`,
        targetLabel: col?.getAttribute("aria-label") ?? "",
      });
    }

    function onClick(e: MouseEvent) {
      const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-board-move-label]");
      if (!link) return;
      e.preventDefault();
      link.closest("details")?.removeAttribute("open");
      const personId = link.closest<HTMLElement>("[data-person-id]")?.dataset.personId;
      const rawAction = new URL(link.href).searchParams.get("openAction");
      if (!personId || !rawAction || !isBoardDropAction(rawAction)) return;
      const action = rawAction;
      setPendingMove({ personId, action, href: link.href, targetLabel: link.dataset.boardMoveLabel ?? "" });
    }

    root.addEventListener("dragstart", onDragStart);
    root.addEventListener("dragover", onDragOver);
    root.addEventListener("drop", onDrop);
    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("dragstart", onDragStart);
      root.removeEventListener("dragover", onDragOver);
      root.removeEventListener("drop", onDrop);
      root.removeEventListener("click", onClick);
    };
  }, [router]);

  function confirmMove() {
    if (!pendingMove) return;
    if (pendingMove.action === "meeting" || pendingMove.action === "discard") {
      setActiveForm({ kind: pendingMove.action, personId: pendingMove.personId });
    } else {
      router.push(pendingMove.href);
    }
    setPendingMove(null);
  }

  function closeForm() {
    setActiveForm(null);
    setError(null);
  }

  return (
    <div ref={rootRef}>
      {children}
      {pendingMove && (
        <Dialog
          open
          onClose={() => setPendingMove(null)}
          title={`${labels.titlePrefix} ${pendingMove.targetLabel}`}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setPendingMove(null)}>
                {labels.cancel}
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmMove}>
                {labels.confirm}
              </button>
            </>
          }
        >
          <p>{labels.body}</p>
        </Dialog>
      )}

      {activeForm?.kind === "meeting" && (
        <MeetingForm
          labels={recordLabels}
          busy={busy}
          error={error}
          onCancel={closeForm}
          onSubmit={async (date, time, notes) => {
            setBusy(true);
            setError(null);
            const result = await logContactMeetingAction(activeForm.personId, date, time, notes);
            setBusy(false);
            if (result.ok) {
              closeForm();
              router.refresh();
            } else {
              setError({ message: contactActionErrorMessage(recordLabels, result.reason) });
            }
          }}
        />
      )}

      {activeForm?.kind === "discard" && (
        <DiscardForm
          labels={recordLabels}
          busy={busy}
          error={error}
          onCancel={closeForm}
          onSubmit={async (reason, note) => {
            setBusy(true);
            setError(null);
            const result = await discardContactAction(activeForm.personId, reason, note);
            setBusy(false);
            if (result.ok) {
              closeForm();
              router.refresh();
            } else {
              setError({ message: contactActionErrorMessage(recordLabels, result.reason) });
            }
          }}
        />
      )}
    </div>
  );
}

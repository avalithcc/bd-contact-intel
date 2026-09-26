"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { boardDropAction, isBoardStatus } from "@/lib/contacts/board";
import { Dialog } from "@/components/Dialog";

export interface BoardMoveConfirmLabels {
  titlePrefix: string;
  body: string;
  confirm: string;
  cancel: string;
}

interface PendingMove {
  href: string;
  targetLabel: string;
}

/**
 * Drag-and-drop progressive enhancement for the Contacts board (task 14.1,
 * 10.5; mockup-parity 4.3 move-confirm dialog). Purely a navigation
 * trigger — dropping a card on a column, or picking a target from a
 * card's "Mover a..." menu, never writes status itself; it navigates to
 * `/contacts/[id]?openAction=X`, which opens the SAME quick-action
 * composer (`QuickActions`) the record page already wires to
 * `logContactMeetingAction`/`discardContactAction`/`sendContactEmailAction`
 * (design R4, tasks.md 10.2-10.3). Both gestures now go through a shared
 * `Dialog` confirm step before that navigation, so a drag or a stray
 * click never silently leaves the board. Every card also renders a
 * native `<details>` "Mover a..." menu (see `BoardCard` in `Board.tsx`)
 * that still reaches the exact same URL without JS (confirm step
 * included, since without JS the click just follows the link directly).
 */
export function BoardDnD({ children, labels }: { children: ReactNode; labels: BoardMoveConfirmLabels }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);

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
        href: `/contacts/${personId}?openAction=${action}`,
        targetLabel: col?.getAttribute("aria-label") ?? "",
      });
    }

    function onClick(e: MouseEvent) {
      const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-board-move-label]");
      if (!link) return;
      e.preventDefault();
      link.closest("details")?.removeAttribute("open");
      setPendingMove({ href: link.href, targetLabel: link.dataset.boardMoveLabel ?? "" });
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
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  router.push(pendingMove.href);
                  setPendingMove(null);
                }}
              >
                {labels.confirm}
              </button>
            </>
          }
        >
          <p>{labels.body}</p>
        </Dialog>
      )}
    </div>
  );
}

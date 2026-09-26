"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { boardDropAction, isBoardStatus } from "@/lib/contacts/board";

/**
 * Drag-and-drop progressive enhancement for the Contacts board (task 14.1,
 * 10.5). Purely a navigation trigger — dropping a card on a column never
 * writes status itself; it navigates to `/contacts/[id]?openAction=X`,
 * which opens the SAME quick-action composer (`QuickActions`) the record
 * page already wires to `logContactMeetingAction`/`discardContactAction`/
 * `sendContactEmailAction` (design R4, tasks.md 10.2-10.3). Every card also
 * renders a native `<details>` "Mover a..." menu (see `BoardCard` in
 * `Board.tsx`) that reaches the exact same URLs without JS or a mouse —
 * this component only adds the drag gesture on top of that, so nothing
 * here is a functionality requirement.
 *
 * No props: it scans `[data-person-id]` cards and `[data-board-status]`
 * columns already rendered by the server component, keeping this the only
 * client-side piece of an otherwise fully server-rendered board.
 */
export function BoardDnD({ children }: { children: ReactNode }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);

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
      router.push(`/contacts/${personId}?openAction=${action}`);
    }

    root.addEventListener("dragstart", onDragStart);
    root.addEventListener("dragover", onDragOver);
    root.addEventListener("drop", onDrop);
    return () => {
      root.removeEventListener("dragstart", onDragStart);
      root.removeEventListener("dragover", onDragOver);
      root.removeEventListener("drop", onDrop);
    };
  }, [router]);

  return <div ref={rootRef}>{children}</div>;
}

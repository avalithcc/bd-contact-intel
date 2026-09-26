"use client";

/**
 * Selection + bulk-action bar for the `/contacts` table (task 13.2; mockup
 * `.bulk-bar`). This PR (13b1a) wires "Asignar responsable" only —
 * "Crear tarea" ships in follow-up PR 13b1b on top of this branch
 * (feature-branch-chain); "Generar mensajes" is deferred, "Exportar" ships
 * in a later slice. Wraps the (server-rendered) table as `children` so row
 * checkboxes stay plain HTML — this component only needs a ref to the
 * shared `<form>` to count checked boxes and wire "select all" (event
 * delegation, no per-row React state).
 *
 * Only one `type="submit"` button ever exists in the DOM at a time (the
 * confirm button of the open mini-panel) so pressing Enter in a text input
 * can't accidentally submit a different action with an empty owner select
 * (which would unassign every selected Contact).
 */
import { useEffect, useRef, useState } from "react";
import { bulkAssignOwnerAction } from "./bulkActions";
import type { BulkActionsLabels } from "@/lib/contacts/labels";
import styles from "./page.module.css";

export interface BulkActionsBarProps {
  labels: BulkActionsLabels;
  ownerOptions: { id: string; name: string }[];
  view: string;
  q?: string;
  page: number;
  children: React.ReactNode;
}

type Panel = "owner" | null;

export function BulkActionsBar({ labels: l, ownerOptions, view, q, page, children }: BulkActionsBarProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);

  function recount() {
    const form = formRef.current;
    if (!form) return;
    setSelectedCount(form.querySelectorAll('input[name="personId"]:checked').length);
  }

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    function onChange(e: Event) {
      const target = e.target as HTMLInputElement;
      if (target.id === "select-all-contacts") {
        const boxes = formRef.current?.querySelectorAll<HTMLInputElement>('input[name="personId"]');
        boxes?.forEach((box) => {
          box.checked = target.checked;
        });
      }
      recount();
    }

    form.addEventListener("change", onChange);
    return () => form.removeEventListener("change", onChange);
  }, []);

  function clearSelection() {
    const boxes = formRef.current?.querySelectorAll<HTMLInputElement>('input[name="personId"]');
    boxes?.forEach((box) => {
      box.checked = false;
    });
    setSelectedCount(0);
    setPanel(null);
  }

  return (
    <form ref={formRef} action={bulkAssignOwnerAction}>
      <input type="hidden" name="view" value={view} />
      {q && <input type="hidden" name="q" value={q} />}
      <input type="hidden" name="page" value={page} />

      {children}

      {selectedCount > 0 && (
        <div className={styles.bulkBar} role="region" aria-label={l.bulkAssignOwner}>
          <span>
            {selectedCount} {l.bulkSelectedSuffix}
          </span>

          {panel === null && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPanel("owner")}>
                {l.bulkAssignOwner}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={clearSelection}
                aria-label={l.bulkClearSelection}
              >
                {l.bulkClearSelection}
              </button>
            </>
          )}

          {panel === "owner" && (
            <>
              <label>
                {l.bulkOwnerLabel}
                <select name="ownerBdId" defaultValue="">
                  <option value="">{l.bulkOwnerUnassign}</option>
                  {ownerOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn btn-primary btn-sm">
                {l.bulkConfirm}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPanel(null)}>
                {l.bulkCancel}
              </button>
            </>
          )}
        </div>
      )}
    </form>
  );
}

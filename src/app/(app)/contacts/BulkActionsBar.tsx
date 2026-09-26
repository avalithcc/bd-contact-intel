"use client";

/**
 * Selection + bulk-action bar for the `/contacts` table (task 13.2; mockup
 * `.bulk-bar`): "Asignar responsable" (PR 13b1a), "Crear tarea" (PR 13b1b),
 * "Exportar" (this PR, 13b2). "Generar mensajes" (bulk AI) is explicitly
 * deferred. Wraps the (server-rendered) table as `children` so row
 * checkboxes stay plain HTML — this component only needs a ref to the
 * shared `<form>` to count checked boxes and wire "select all" (event
 * delegation, no per-row React state).
 *
 * Only one `type="submit"` button ever exists in the DOM at a time (the
 * confirm button of whichever mini-panel is open) so pressing Enter in a
 * text/date input can't accidentally submit a different action with an
 * empty owner select (which would unassign every selected Contact).
 * "Exportar" stays `type="button"` and navigates via a plain GET href built
 * from the checked ids — it never touches the shared form's action, so it
 * can't violate that invariant either.
 */
import { useEffect, useRef, useState } from "react";
import { bulkAssignOwnerAction, bulkCreateTaskAction } from "./bulkActions";
import type { BulkActionsLabels } from "@/lib/contacts/labels";
import type { ContactColumnKey } from "@/lib/contacts/columns";

export interface BulkActionsBarProps {
  labels: BulkActionsLabels;
  ownerOptions: { id: string; name: string }[];
  view: string;
  q?: string;
  page: number;
  // The active view's currently visible columns (src/lib/contacts/columns.ts)
  // — "Exportar" downloads exactly what's on screen, same column set.
  columns: ContactColumnKey[];
  children: React.ReactNode;
}

/** Builds the `/contacts/export` GET href from the checked personId boxes —
 * read directly off the DOM (no React state) so it always reflects the live
 * selection at click time, same source of truth as `recount()` below. */
function buildExportHref(form: HTMLFormElement, columns: ContactColumnKey[]): string {
  const ids = [...form.querySelectorAll<HTMLInputElement>('input[name="personId"]:checked')].map(
    (box) => box.value,
  );
  const params = new URLSearchParams();
  for (const id of ids) params.append("personId", id);
  if (columns.length) params.set("columns", columns.join(","));
  return `/contacts/export?${params.toString()}`;
}

type Panel = "owner" | "task" | null;

export function BulkActionsBar({ labels: l, ownerOptions, view, q, page, columns, children }: BulkActionsBarProps) {
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
        <div className="bulk-bar" role="region" aria-label={l.bulkAssignOwner}>
          <span className="count">
            {selectedCount} {l.bulkSelectedSuffix}
          </span>
          <span className="sep" />

          {panel === null && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPanel("owner")}>
                {l.bulkAssignOwner}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPanel("task")}>
                {l.bulkCreateTask}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const form = formRef.current;
                  if (!form) return;
                  window.location.href = buildExportHref(form, columns);
                }}
              >
                {l.bulkExport}
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

          {panel === "task" && (
            <>
              <label>
                {l.bulkTaskTitleLabel}
                <input type="text" name="title" required />
              </label>
              <label>
                {l.bulkTaskDueLabel}
                <input type="date" name="dueAt" />
              </label>
              <button type="submit" formAction={bulkCreateTaskAction} className="btn btn-primary btn-sm">
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

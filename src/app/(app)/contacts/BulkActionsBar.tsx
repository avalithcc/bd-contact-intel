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
 * confirm button of whichever action Dialog is open — a closed Dialog
 * renders `null`, see @/components/Dialog) so pressing Enter in a
 * text/date input can't accidentally submit a different action with an
 * empty owner select (which would unassign every selected Contact).
 * "Exportar" stays `type="button"` and navigates via a plain GET href built
 * from the checked ids — it never touches the shared form's action, so it
 * can't violate that invariant either.
 */
import { useRef, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { CloseIcon, DownloadIcon, PersonIcon, TasksIcon } from "@/components/icons";
import { bulkAssignOwnerAction, bulkCreateTaskAction } from "./bulkActions";
import { buildTaskAssigneeOptions } from "@/lib/tasks/assignee";
import { resolveSelectAllChecked } from "@/lib/contacts/bulkSelection";
import { BulkGenerateMessagesButton } from "./BulkGenerateMessagesButton";
import type { BulkActionsLabels } from "@/lib/contacts/labels";
import type { ContactColumnKey } from "@/lib/contacts/columns";
import type { Locale } from "@/lib/i18n/locales";
import type { GenerateMessageLabels } from "@/lib/outreach/messageLabels";

export interface BulkActionsBarProps {
  labels: BulkActionsLabels;
  ownerOptions: { id: string; name: string }[];
  // Current BD's id — preselects "Asignado a" and marks that option "(yo)"
  // via buildTaskAssigneeOptions (mockup contact-record.html #task).
  meId: string;
  view: string;
  q?: string;
  page: number;
  // The active view's currently visible columns (src/lib/contacts/columns.ts)
  // — "Exportar" downloads exactly what's on screen, same column set.
  columns: ContactColumnKey[];
  // "Generar mensajes" (bulk AI, this batch) — same locale/labels the
  // per-contact GenerateMessageButton already uses.
  locale: Locale;
  messageLabels: GenerateMessageLabels;
  // "Seleccionar los N" (contacts.html:104) — total rows matching the
  // active filter. `filtersQuery`/`sort` are the SAME serialized
  // ContactFilters/sort the toolbar's own "Exportar" already uses (see
  // page.tsx toolbarExportHref) — filter-wide mode sends these instead of
  // ids, and the server re-derives the id set itself.
  total: number;
  filtersQuery: string;
  sort: string;
  wholeViewExportHref: string;
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

export function BulkActionsBar({
  labels: l,
  ownerOptions,
  meId,
  view,
  q,
  page,
  columns,
  locale,
  messageLabels,
  total,
  filtersQuery,
  sort,
  wholeViewExportHref,
  children,
}: BulkActionsBarProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  // "Seleccionar los N" filter-wide mode: true once the BD has clicked
  // "Seleccionar los N" AND there are more matches than fit on this page.
  // While true, owner/task/messages/export submit `mode=filter` +
  // `filtersQuery`/`sort` instead of the checked personId list — the
  // server re-derives the id set itself (getContactIdsForFilters).
  const [filterWideMode, setFilterWideMode] = useState(false);

  function recount() {
    const form = formRef.current;
    if (!form) return;
    setSelectedCount(form.querySelectorAll('input[name="personId"]:checked').length);
  }

  /**
   * Bug fix: was a `useEffect(() => form.addEventListener(...), [])` —
   * fragile because it depends on `formRef.current` already being set by
   * the time the effect runs, and on the native listener correctly seeing
   * every bubbled checkbox "change" event. A plain JSX `onChange` on the
   * `<form>` below uses React's own synthetic event delegation instead,
   * which is attached unconditionally on first render — no ref-timing
   * race, no dependency on manual DOM listener wiring at all.
   */
  function handleFormChange(e: React.ChangeEvent<HTMLFormElement>) {
    const target = e.target as unknown as HTMLInputElement;
    const selectAllChecked = resolveSelectAllChecked(target.id, target.checked);
    if (selectAllChecked !== null) {
      const boxes = formRef.current?.querySelectorAll<HTMLInputElement>('input[name="personId"]');
      boxes?.forEach((box) => {
        box.checked = selectAllChecked;
      });
    }
    recount();
  }

  function clearSelection() {
    const boxes = formRef.current?.querySelectorAll<HTMLInputElement>('input[name="personId"]');
    boxes?.forEach((box) => {
      box.checked = false;
    });
    setSelectedCount(0);
    setFilterWideMode(false);
    setPanel(null);
  }

  /**
   * "Seleccionar los N" (contacts.html:104) — genuinely filter-wide.
   * Checks every row on THIS page for visual feedback (same as the header
   * checkbox), but the actual owner/task/messages/export submission
   * switches to `mode=filter` (hidden fields below): the server re-derives
   * the id set from `filtersQuery`/`sort` itself, capped at
   * BULK_FILTER_TARGET_CAP (owner/task), MAX_VIEW_EXPORT_ROWS (export), or
   * MAX_BULK_GENERATE_MESSAGES (messages — stays 25 regardless of `total`).
   */
  function selectAllMatching() {
    const boxes = formRef.current?.querySelectorAll<HTMLInputElement>('input[name="personId"]');
    boxes?.forEach((box) => {
      box.checked = true;
    });
    setFilterWideMode(true);
    recount();
  }

  return (
    <form ref={formRef} action={bulkAssignOwnerAction} onChange={handleFormChange}>
      <input type="hidden" name="view" value={view} />
      {q && <input type="hidden" name="q" value={q} />}
      <input type="hidden" name="page" value={page} />
      {filterWideMode && (
        <>
          <input type="hidden" name="mode" value="filter" />
          <input type="hidden" name="filtersQuery" value={filtersQuery} />
          <input type="hidden" name="sort" value={sort} />
        </>
      )}

      {/* Bulk bar sits above the table, as in mockups/contacts.html, so it is
          visible as soon as a row is checked (it used to render below all 50 rows).
          Fixed shape (count, action buttons, "Seleccionar los N", "Quitar
          selección") regardless of which action is open — each action's own
          fields now live in a Dialog (below), not inline in the bar, so
          choosing one never changes the bar's size or look. */}
      {selectedCount > 0 && (
        <div className="bulk-bar" role="region" aria-label={l.bulkAssignOwner}>
          <span className="count">
            {filterWideMode ? total : selectedCount} {l.bulkSelectedSuffix}
          </span>
          <span className="sep" />

          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPanel("owner")}>
            <PersonIcon className="icon" />
            {l.bulkAssignOwner}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPanel("task")}>
            <TasksIcon className="icon" />
            {l.bulkCreateTask}
          </button>
          <BulkGenerateMessagesButton
            formRef={formRef}
            locale={locale}
            labels={l}
            messageLabels={messageLabels}
            filterWideMode={filterWideMode}
            filtersQuery={filtersQuery}
            sort={sort}
            q={q}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (filterWideMode) {
                window.location.href = wholeViewExportHref;
                return;
              }
              const form = formRef.current;
              if (!form) return;
              window.location.href = buildExportHref(form, columns);
            }}
          >
            <DownloadIcon className="icon" />
            {l.bulkExport}
          </button>
          <span className="grow" />
          {total > selectedCount && !filterWideMode && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={selectAllMatching}>
              {l.bulkSelectAllMatching.replace("{n}", String(total))}
            </button>
          )}
          {filterWideMode && <span className="meta">{l.bulkSelectAllMatchingNotice}</span>}
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={clearSelection}
            aria-label={l.bulkClearSelection}
          >
            <CloseIcon className="icon" />
          </button>
        </div>
      )}

      {/* "Asignar responsable" — same shared Dialog pattern as
          SaveViewDialog.tsx/BulkGenerateMessagesButton.tsx. The <select>
          stays inside the outer bulk-selection <form> (real DOM nesting,
          Dialog renders no portal), so it submits with the same hidden
          view/q/page/mode/filtersQuery/sort fields and the checked
          personId boxes untouched. */}
      <Dialog
        open={panel === "owner"}
        onClose={() => setPanel(null)}
        title={l.bulkAssignOwner}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setPanel(null)}>
              {l.bulkCancel}
            </button>
            <button type="submit" className="btn btn-primary">
              {l.bulkConfirm}
            </button>
          </>
        }
      >
        <div className="field">
          <label className="label" htmlFor="bulk-owner-select">
            {l.bulkOwnerLabel}
          </label>
          <select id="bulk-owner-select" className="select" name="ownerBdId" defaultValue="">
            <option value="">{l.bulkOwnerUnassign}</option>
            {ownerOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      </Dialog>

      {/* "Crear tarea" — same pattern; submits via `formAction` so it hits
          bulkCreateTaskAction instead of the form's default
          bulkAssignOwnerAction, exactly as before the Dialog wrap. */}
      <Dialog
        open={panel === "task"}
        onClose={() => setPanel(null)}
        title={l.bulkCreateTask}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setPanel(null)}>
              {l.bulkCancel}
            </button>
            <button type="submit" formAction={bulkCreateTaskAction} className="btn btn-primary">
              {l.bulkConfirm}
            </button>
          </>
        }
      >
        <div className="field">
          <label className="label" htmlFor="bulk-task-title">
            {l.bulkTaskTitleLabel}
          </label>
          <input id="bulk-task-title" className="input" type="text" name="title" required />
        </div>
        {/* Vencimiento + Asignado a side by side (approved mockup
            contact-record.html #task's `.form-grid`) — mirrored here since
            this dialog has no mockup of its own. No "(responsable)" marker:
            a bulk selection spans many contacts, each with its own (or no)
            owner, so there is no single owner to mark without an extra
            per-contact query. */}
        <div className="form-grid">
          <div className="field">
            <label className="label" htmlFor="bulk-task-due">
              {l.bulkTaskDueLabel}
            </label>
            <input id="bulk-task-due" className="input" type="date" name="dueAt" />
          </div>
          <div className="field">
            <label className="label" htmlFor="bulk-task-assignee">
              {l.bulkTaskAssigneeLabel}
            </label>
            <select id="bulk-task-assignee" className="select" name="assignedToBdId" defaultValue={meId}>
              {buildTaskAssigneeOptions(ownerOptions, meId).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {/* Descripción: not in the approved mockup — a deliberate deviation,
            kept because the backlog explicitly asked for a write path. */}
        <div className="field">
          <label className="label" htmlFor="bulk-task-description">
            {l.bulkTaskDescriptionLabel}
          </label>
          <textarea id="bulk-task-description" className="textarea" name="description" />
        </div>
      </Dialog>

      {children}
    </form>
  );
}

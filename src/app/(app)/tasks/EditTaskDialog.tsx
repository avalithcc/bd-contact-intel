"use client";

import { useEffect, useId, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { useToast } from "@/components/ToastProvider";
import { taskDueDate, formatTaskDueDate } from "@/lib/tasks/argentinaDate";
import { buildTaskAssigneeOptions } from "@/lib/tasks/assignee";
import { updateTaskAction, setTaskStatusAction, getTaskCompletionInfoAction } from "./actions";

export interface EditableTask {
  id: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  assignedToBdId: string | null;
  status: "open" | "done" | "cancelled";
  personId: string | null;
  companyKey: string | null;
  /** Precomputed "Joaquín Ortega · Kavak" / "Kavak (empresa)" text for the
   * read-only "Asociado con" field (mockup decision 3) — never fetched here,
   * always already known by whichever page renders the trigger. */
  associationLabel: string;
}

export interface EditTaskLabels {
  dialogTitle: string;
  fieldTitle: string;
  fieldDue: string;
  fieldAssignee: string;
  fieldDescription: string;
  fieldAssociation: string;
  associationHelp: string;
  titleRequiredError: string;
  markComplete: string;
  reopenTask: string;
  cancel: string;
  saveChanges: string;
  saving: string;
  saveError: string;
  genericError: string;
  completedBadge: string;
  completedCaptionPrefix: string;
  toastUpdated: string;
  toastCompleted: string;
  toastReopened: string;
}

/**
 * "Editar tarea" dialog (task-edit change; mockups/task-edit.html). One
 * shared component reachable from three surfaces — /tasks rows, the
 * contact/company record's Tareas card, and the contact timeline's
 * "Reprogramar" button — each rendering it via their own small trigger
 * (TaskTitleLink.tsx, or Timeline.tsx's own local state).
 *
 * Markup follows the Dialog pattern exactly (see NewTaskButton.tsx's own
 * doc comment): `.field` > `label.label[htmlFor]` built with useId, a
 * `footer` prop, classed buttons, `onCloseRef` (inside Dialog itself).
 */
export function EditTaskDialog({
  task,
  assigneeOptions,
  meId,
  labels: l,
  onClose,
  onSaved,
  // Test seam (screenshot probe only — see src/app/login-task-edit-probe):
  // every real caller relies on the defaults, which are the actual server
  // actions. Never passed from production code.
  updateTask = updateTaskAction,
  setTaskStatus = setTaskStatusAction,
  getTaskCompletionInfo = getTaskCompletionInfoAction,
}: {
  task: EditableTask;
  assigneeOptions: { id: string; name: string }[];
  meId: string;
  labels: EditTaskLabels;
  onClose: () => void;
  onSaved?: () => void;
  updateTask?: typeof updateTaskAction;
  setTaskStatus?: typeof setTaskStatusAction;
  getTaskCompletionInfo?: typeof getTaskCompletionInfoAction;
}) {
  const { showToast } = useToast();
  const ids = useId();

  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueAt ? taskDueDate(task.dueAt) : "");
  const [assignedToBdId, setAssignedToBdId] = useState(task.assignedToBdId ?? meId);
  const [description, setDescription] = useState(task.description ?? "");
  const [titleError, setTitleError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(task.status);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [completionInfo, setCompletionInfo] = useState<{ at: Date; byName: string | null } | null>(null);

  // Reset local state whenever a DIFFERENT task is opened (the trigger
  // unmounts/remounts this dialog per task, but guards this anyway in case
  // a future caller keeps one instance alive across tasks).
  useEffect(() => {
    setTitle(task.title);
    setDueDate(task.dueAt ? taskDueDate(task.dueAt) : "");
    setAssignedToBdId(task.assignedToBdId ?? meId);
    setDescription(task.description ?? "");
    setTitleError(false);
    setStatus(task.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset keyed on task.id alone
  }, [task.id]);

  // Lazy fetch for the "Completada el … · <nombre>" caption (mockup decision
  // 5; PERFORMANCE.md: never fetched unless the dialog actually needs it) —
  // only when the task is ALREADY completed on open.
  useEffect(() => {
    if (task.status !== "done") {
      setCompletionInfo(null);
      return;
    }
    let cancelled = false;
    getTaskCompletionInfo(task.id).then((info) => {
      if (!cancelled) setCompletionInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [task.id, task.status]);

  const assigneeSelectOptions = buildTaskAssigneeOptions(assigneeOptions, meId);
  const isCompleted = status === "done";

  async function handleSave() {
    if (!title.trim()) {
      setTitleError(true);
      return;
    }
    setTitleError(false);
    setSaving(true);
    try {
      await updateTask(task.id, {
        title: title.trim(),
        dueAt: dueDate ? new Date(dueDate) : null,
        assignedToBdId,
        description: description.trim() || null,
      });
      showToast(l.toastUpdated);
      onSaved?.();
      onClose();
    } catch {
      setSaving(false);
      showToast(l.saveError, "error");
    }
  }

  async function handleToggleStatus() {
    const nextStatus = isCompleted ? "open" : "done";
    setTogglingStatus(true);
    try {
      await setTaskStatus(task.id, nextStatus);
      setStatus(nextStatus);
      if (nextStatus === "open") setCompletionInfo(null);
      showToast(nextStatus === "done" ? l.toastCompleted : l.toastReopened);
      onSaved?.();
    } catch {
      showToast(l.genericError, "error");
    } finally {
      setTogglingStatus(false);
    }
  }

  // Mockup decision 7: ONLY the "Guardar cambios" save disables the fields
  // (including Asignado/Descripción, which the mockup's own saving swatch
  // missed) — toggling complete/reopen never touches the fields, it's a
  // separate, much faster write. Every footer button disables during
  // EITHER action, so the two can't race each other.
  const fieldsDisabled = saving;
  const busy = saving || togglingStatus;

  return (
    <Dialog
      open
      onClose={onClose}
      closeDisabled={saving}
      title={
        <>
          {l.dialogTitle}
          {isCompleted && <span className="badge badge-success no-dot">{l.completedBadge}</span>}
        </>
      }
      footer={
        <>
          <button type="button" className="btn btn-secondary left" disabled={busy} onClick={handleToggleStatus}>
            {isCompleted ? l.reopenTask : l.markComplete}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            {l.cancel}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={handleSave}>
            {saving && <span className="spinner" aria-hidden="true" />}
            {saving ? l.saving : l.saveChanges}
          </button>
        </>
      }
    >
      {isCompleted && (
        <p className="meta">
          {l.completedCaptionPrefix}{" "}
          {completionInfo ? formatTaskDueDate(completionInfo.at) : task.dueAt ? formatTaskDueDate(task.dueAt) : ""}
          {completionInfo?.byName ? ` · ${completionInfo.byName}` : ""}
        </p>
      )}

      <div className="field">
        <label className="label" htmlFor={`${ids}-title`}>
          {l.fieldTitle}
        </label>
        <input
          id={`${ids}-title`}
          className={titleError ? "input is-invalid" : "input"}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (titleError && e.target.value.trim()) setTitleError(false);
          }}
          disabled={fieldsDisabled}
          required
        />
        {titleError && <span className="error-text">{l.titleRequiredError}</span>}
      </div>

      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor={`${ids}-due`}>
            {l.fieldDue}
          </label>
          <input
            id={`${ids}-due`}
            className="input"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={fieldsDisabled}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${ids}-assignee`}>
            {l.fieldAssignee}
          </label>
          <select
            id={`${ids}-assignee`}
            className="select"
            value={assignedToBdId}
            onChange={(e) => setAssignedToBdId(e.target.value)}
            disabled={fieldsDisabled}
          >
            {assigneeSelectOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor={`${ids}-description`}>
          {l.fieldDescription}
        </label>
        <textarea
          id={`${ids}-description`}
          className="textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={fieldsDisabled}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor={`${ids}-assoc`}>
          {l.fieldAssociation}
        </label>
        <input id={`${ids}-assoc`} className="input" value={task.associationLabel} disabled />
        <span className="help">{l.associationHelp}</span>
      </div>
    </Dialog>
  );
}

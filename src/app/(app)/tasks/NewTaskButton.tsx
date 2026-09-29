"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/Dialog";
import { useToast } from "@/components/ToastProvider";
import { PlusIcon } from "@/components/icons";
import type { TaskSubjectSearchResult } from "@/lib/tasks/subjectSearch";
import { buildTaskAssigneeOptions } from "@/lib/tasks/assignee";
import { createTaskAction, searchTaskSubjectsAction } from "./actions";
import styles from "./NewTaskButton.module.css";

export interface NewTaskButtonLabels {
  newTask: string;
  taskCreate: string;
  taskTitleLabel: string;
  taskDescriptionLabel: string;
  taskSubjectLabel: string;
  taskSubjectPlaceholder: string;
  taskSubjectContactOption: string;
  taskSubjectCompanyOption: string;
  taskSubjectSearching: string;
  taskSubjectNoResults: string;
  taskSubjectRequired: string;
  taskDueLabel: string;
  taskAssigneeLabel: string;
  taskCreateError: string;
  cancel: string;
}

export interface TaskAssigneeOption {
  id: string;
  name: string;
}

const SEARCH_DEBOUNCE_MS = 250;

/**
 * "Nueva tarea" primary button + dialog (mockup-port t04; tasks.html
 * `.page-header .actions .btn-primary`). An earlier reskin left this as a
 * dead link. The dialog's subject picker searches contacts by name (owner
 * instruction) and companies by display name, then reuses the existing
 * createTaskAction (src/app/(app)/tasks/actions.ts) — same write path as
 * the record page's "Tarea" quick action and bulk "Crear tarea" — no new
 * write path is introduced here.
 */
export function NewTaskButton({
  labels: l,
  assigneeOptions,
  meId,
}: {
  labels: NewTaskButtonLabels;
  assigneeOptions: TaskAssigneeOption[];
  // Preselects "Asignado a" and marks that option "(yo)" — no subject is
  // known yet when this dialog opens (the subject picker below is how the
  // user chooses one), so there is no owner to mark "(responsable)" without
  // an extra query; skipped, per the mockup's own optional marker.
  meId: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignedToBdId, setAssignedToBdId] = useState(meId);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TaskSubjectSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [subject, setSubject] = useState<TaskSubjectSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (subject || query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const found = await searchTaskSubjectsAction(query);
      if (!cancelled) {
        setResults(found);
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, subject]);

  function close() {
    setOpen(false);
    setTitle("");
    setDescription("");
    setDueDate("");
    setAssignedToBdId(meId);
    setQuery("");
    setResults([]);
    setSubject(null);
    setError(null);
  }

  async function handleSubmit() {
    if (!title.trim() || !subject) return;
    setBusy(true);
    setError(null);
    try {
      await createTaskAction({
        title: title.trim(),
        description: description.trim() || undefined,
        dueAt: dueDate ? new Date(dueDate) : undefined,
        personId: subject.type === "person" ? subject.id : undefined,
        companyKey: subject.type === "company" ? subject.id : undefined,
        assignedToBdId,
      });
      close();
      showToast(l.taskCreate);
      router.refresh();
    } catch {
      setBusy(false);
      setError(l.taskCreateError);
      showToast(l.taskCreateError, "error");
    }
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <PlusIcon className="icon" />
        {l.newTask}
      </button>

      {open && (
        <Dialog open onClose={close} title={l.taskCreate}>
          <div className="composer">
            {error && (
              <div className="error-text" role="alert">
                {error}
              </div>
            )}
            <label className="field">
              {l.taskTitleLabel}
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
            </label>

            <label className="field">
              {l.taskSubjectLabel}
              {subject ? (
                <div className={styles.subjectChip}>
                  <span>
                    {subject.type === "person" ? l.taskSubjectContactOption : l.taskSubjectCompanyOption}: {subject.label}
                  </span>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setSubject(null)} disabled={busy}>
                    ×
                  </button>
                </div>
              ) : (
                <div className={styles.searchWrap}>
                  <input
                    className="input"
                    value={query}
                    placeholder={l.taskSubjectPlaceholder}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={busy}
                  />
                  {searching && <p className="hint">{l.taskSubjectSearching}</p>}
                  {!searching && query.trim().length >= 2 && results.length === 0 && (
                    <p className="hint">{l.taskSubjectNoResults}</p>
                  )}
                  {results.length > 0 && (
                    <ul className={styles.results} role="listbox">
                      {results.map((result) => (
                        <li key={`${result.type}:${result.id}`}>
                          <button
                            type="button"
                            className={styles.resultItem}
                            onClick={() => {
                              setSubject(result);
                              setQuery("");
                              setResults([]);
                            }}
                          >
                            {result.type === "person" ? l.taskSubjectContactOption : l.taskSubjectCompanyOption}:{" "}
                            {result.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </label>

            {/* Vencimiento + Asignado a side by side (approved mockup
                contact-record.html #task's `.form-grid`) — mirrored here
                since this dialog has no mockup of its own. */}
            <div className="form-grid">
              <label className="field">
                {l.taskDueLabel}
                <input
                  className="input"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={busy}
                />
              </label>

              <label className="field">
                {l.taskAssigneeLabel}
                <select
                  className="select"
                  value={assignedToBdId}
                  onChange={(e) => setAssignedToBdId(e.target.value)}
                  disabled={busy}
                >
                  {buildTaskAssigneeOptions(assigneeOptions, meId).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Descripción: not in the approved mockup — a deliberate
                deviation, kept because the backlog explicitly asked for a
                write path. */}
            <label className="field">
              {l.taskDescriptionLabel}
              <textarea
                className="textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy}
              />
            </label>

            {!subject && title.trim() && <p className="hint">{l.taskSubjectRequired}</p>}

            <div className="bar">
              <button type="button" onClick={close} disabled={busy}>
                {l.cancel}
              </button>
              <button type="button" disabled={busy || !title.trim() || !subject} onClick={handleSubmit}>
                {l.taskCreate}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

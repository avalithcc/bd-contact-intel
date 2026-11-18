"use client";

import { useState, useTransition } from "react";
import { BusyButton } from "@/components/forms/BusyButton";

/** The one editable note of a tender. Stays editable on failure and says so; an unchanged save is harmless (the server logs nothing). */
export function TenderNoteForm({
  tenderId,
  initial,
  save,
  labels,
}: {
  tenderId: string;
  initial: string;
  save: (id: string, text: string) => Promise<boolean>;
  labels: { label: string; placeholder: string; save: string; saving: string; saved: string; error: string };
}) {
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [pending, startTransition] = useTransition();
  const fieldId = `tender-note-${tenderId}`;

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          try {
            setStatus((await save(tenderId, text)) ? "saved" : "error");
          } catch {
            setStatus("error");
          }
        });
      }}
    >
      <div className="field">
        <label className="label" htmlFor={fieldId}>
          {labels.label}
        </label>
        <textarea
          id={fieldId}
          className="textarea"
          rows={6}
          maxLength={5000}
          value={text}
          placeholder={labels.placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setStatus("idle");
          }}
        />
      </div>
      <div className="row">
        <BusyButton pending={pending} pendingLabel={labels.saving} className="btn btn-primary btn-sm">
          {labels.save}
        </BusyButton>
        <span role="status" className={status === "error" ? "error-text" : "help"}>
          {status === "saved" ? labels.saved : status === "error" ? labels.error : ""}
        </span>
      </div>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import { BusyButton } from "@/components/forms/BusyButton";
import { MAX_REQUIREMENT_NOTE_CHARS } from "@/lib/tenders/requirementStatus";

/**
 * The short reason behind ONE requirement's answer ("vencido, lo renuevan en marzo"). Explicit save, like the tender note: no
 * autosave. Saving sends the note only, so the status is never touched. Stays editable on failure and says so. Strings only.
 */
export function TenderRequirementNote({
  id,
  requirementKey,
  initial,
  save,
  labels,
}: {
  id: string;
  requirementKey: string;
  initial: string;
  save: (id: string, key: string, status: string | undefined, note?: string) => Promise<void>;
  labels: { label: string; placeholder: string; save: string; saving: string; error: string };
}) {
  const [text, setText] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          try {
            await save(id, requirementKey, undefined, text);
            setFailed(false);
          } catch {
            setFailed(true);
          }
        });
      }}
    >
      <input
        className="input input-sm"
        type="text"
        data-requirement-note={requirementKey}
        maxLength={MAX_REQUIREMENT_NOTE_CHARS}
        value={text}
        placeholder={labels.placeholder}
        aria-label={labels.label}
        onChange={(e) => {
          setText(e.target.value);
          setFailed(false);
        }}
      />
      <BusyButton pending={pending} pendingLabel={labels.saving} className="btn btn-primary btn-sm">
        {labels.save}
      </BusyButton>
      <span role="status" className="error-text">
        {failed ? labels.error : ""}
      </span>
    </form>
  );
}

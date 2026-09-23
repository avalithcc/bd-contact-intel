"use client";

import { useState, useTransition } from "react";
import { updateLeadOwnerAction, updateLeadStatusAction } from "./actions";
import type { LeadEditLabels } from "@/lib/leads/labels";
import type { LeadStatusKey } from "@/lib/leads/types";

interface Owner {
  id: string;
  name: string;
}

/**
 * Inline edit control for a lead's status, notes and owner, from the detail
 * page. Any signed-in BD may edit — leads are shared, not per-BD (see
 * src/db/schema.ts#lead). Status/notes and owner are saved independently
 * (two small server actions) so changing one never risks clobbering the
 * other with a stale value.
 */
export function LeadEditForm({
  leadId,
  initialStatus,
  initialNotes,
  initialOwnerId,
  owners,
  labels,
}: {
  leadId: string;
  initialStatus: LeadStatusKey;
  initialNotes: string;
  initialOwnerId: string | null;
  owners: Owner[];
  labels: LeadEditLabels;
}) {
  const [status, setStatus] = useState<LeadStatusKey>(initialStatus);
  const [notes, setNotes] = useState(initialNotes);
  const [ownerId, setOwnerId] = useState(initialOwnerId ?? "");
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function saveStatusAndNotes() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await updateLeadStatusAction(leadId, { status, notes });
      if (!result.ok) setError(labels.saveError);
      else setSaved(true);
    });
  }

  function saveOwner(nextOwnerId: string) {
    setOwnerId(nextOwnerId);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await updateLeadOwnerAction(leadId, nextOwnerId || null);
      if (!result.ok) setError(labels.saveError);
      else setSaved(true);
    });
  }

  return (
    <div className="field-grow">
      <label htmlFor="lead-owner">{labels.fieldOwner}</label>
      <select
        id="lead-owner"
        value={ownerId}
        onChange={(e) => saveOwner(e.target.value)}
        disabled={pending}
      >
        <option value="">{labels.ownerUnassigned}</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>

      <label htmlFor="lead-status" className="mt-md">
        {labels.fieldStatus}
      </label>
      <select
        id="lead-status"
        value={status}
        onChange={(e) => setStatus(e.target.value as LeadStatusKey)}
        disabled={pending}
      >
        {(Object.keys(labels.leadStatuses) as LeadStatusKey[]).map((k) => (
          <option key={k} value={k}>
            {labels.leadStatuses[k]}
          </option>
        ))}
      </select>

      <label htmlFor="lead-notes" className="mt-md">
        {labels.fieldNotes}
      </label>
      <textarea
        id="lead-notes"
        rows={4}
        value={notes}
        placeholder={labels.fieldNotesPlaceholder}
        onChange={(e) => setNotes(e.target.value)}
        disabled={pending}
      />

      <div className="row mt-md">
        <button type="button" onClick={saveStatusAndNotes} disabled={pending}>
          {pending ? labels.savingChanges : labels.saveChanges}
        </button>
        {saved && !pending && <span className="muted">{labels.savedChanges}</span>}
        {error && <span className="text-danger">{error}</span>}
      </div>
    </div>
  );
}

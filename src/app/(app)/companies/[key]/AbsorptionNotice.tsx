"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MergeIcon } from "@/components/icons";
import { useToast } from "@/components/ToastProvider";
import { ABSORPTION_REFUSAL_KEY, type AbsorptionRefusalKey } from "@/lib/companies/absorption";
import type { ClientStrings } from "@/lib/i18n/clientStrings";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { withdrawCompanyAbsorptionAction } from "../actions";

export type AbsorptionNoticeLabels = ClientStrings<
  Pick<
    Dictionary["companyRecord"],
    | "genericError"
    | "absorbPendingTitlePrefix"
    | "absorbPendingWaiting"
    | "absorbUndo"
    | "absorbUndoing"
    | "absorbUndoHelp"
    | "toastAbsorbWithdrawn"
    | AbsorptionRefusalKey
  >
>;

/**
 * Pending-proposal notice (mockup company-absorption/absorcion.html, section 3). Informational only: the record
 * keeps working, nothing is hidden. "Deshacer" is offered to the proposer alone; the server enforces the same rule.
 */
export function AbsorptionNotice({
  proposalId,
  survivorName,
  proposerName,
  when,
  canUndo,
  labels: l,
}: {
  proposalId: string;
  survivorName: string;
  proposerName: string;
  /** Already formatted on the server ("hace 2 días"); the client never formats dates. */
  when: string;
  canUndo: boolean;
  labels: AbsorptionNoticeLabels;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function undo() {
    setBusy(true);
    setError(null);
    try {
      const result = await withdrawCompanyAbsorptionAction(proposalId);
      if (result.ok) {
        showToast(l.toastAbsorbWithdrawn);
      } else {
        setError(l[ABSORPTION_REFUSAL_KEY[result.reason]]);
      }
      router.refresh();
    } catch {
      setError(l.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-lg">
      <div className="pending" role="status">
        <MergeIcon className="icon" />
        <div className="body">
          <div className="title">
            {l.absorbPendingTitlePrefix}
            {survivorName}
          </div>
          <div className="who">
            {proposerName} · {when} · {l.absorbPendingWaiting}
          </div>
        </div>
        {canUndo && (
          <div className="act">
            <button type="button" className="btn btn-sm btn-secondary" onClick={undo} disabled={busy}>
              {busy ? l.absorbUndoing : l.absorbUndo}
            </button>
          </div>
        )}
      </div>
      {error && (
        <p className="error-text mt-md" role="alert">
          {error}
        </p>
      )}
      {canUndo && <p className="meta mt-md">{l.absorbUndoHelp}</p>}
    </div>
  );
}

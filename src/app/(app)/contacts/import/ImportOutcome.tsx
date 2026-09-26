"use client";

import type { ContactsImportLabels } from "@/lib/contacts/labels";
import type { IdentityIngestReport } from "@/lib/identity/ingestWrite";

/**
 * Dedup outcome summary (task 14.2; mockups/import.html "Importación
 * finalizada"): renders the SAME `IdentityWritePlan.report` the identity
 * resolver produces for both ingestion sources (`upsertContacts` for
 * LinkedIn connections, `importLeads` for a leads CSV) — see
 * `sumIdentityReports` (src/lib/identity/ingestWrite.ts). `null` means the
 * import ran with `IDENTITY_DUAL_WRITE` off, which has nothing to report
 * (not an error).
 */
export function ImportOutcome({
  report,
  labels: l,
}: {
  report: IdentityIngestReport | null;
  labels: ContactsImportLabels;
}) {
  if (!report) {
    return <p className="muted mb-0">{l.outcomeUnavailable}</p>;
  }

  return (
    <div>
      <p className="muted mb-0">
        <strong>{l.outcomeTitle}:</strong> {l.outcomeAutoMerged} {report.autoMerged} ·{" "}
        {l.outcomeFlaggedForReview} {report.flaggedForReview} · {l.outcomeNew} {report.new} ·{" "}
        {l.outcomeSkippedOwnCompany} {report.ownCompanySkipped}
      </p>
      {report.flaggedForReview > 0 && (
        <p className="muted mb-0">
          <a href="/admin/duplicates">{l.outcomeReviewQueueLink}</a>
        </p>
      )}
    </div>
  );
}

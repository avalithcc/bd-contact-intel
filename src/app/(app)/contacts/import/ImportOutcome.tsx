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
  ownCompanySkippedBeforeMatching = 0,
  counts,
}: {
  // Contact-level counts (connections import only): unchanged rows were not
  // written at all. Leads imports omit it.
  counts?: { created: number; updated: number; unchanged: number };
  report: IdentityIngestReport | null;
  labels: ContactsImportLabels;
  // Rows dropped by the own-company pre-filter before they reach the
  // resolver (src/lib/ownCompany.ts); the resolver only counts the rest.
  ownCompanySkippedBeforeMatching?: number;
}) {
  const countsLine = counts && (
    <p className="muted mb-0">
      {l.outcomeContactsCreated} {counts.created} · {l.outcomeContactsUpdated} {counts.updated} ·{" "}
      {l.outcomeContactsUnchanged} {counts.unchanged}
    </p>
  );

  if (!report) {
    return (
      <div>
        {countsLine}
        <p className="muted mb-0">{l.outcomeUnavailable}</p>
      </div>
    );
  }

  return (
    <div>
      {countsLine}
      <p className="muted mb-0">
        <strong>{l.outcomeTitle}:</strong> {l.outcomeAutoMerged} {report.autoMerged} ·{" "}
        {l.outcomeFlaggedForReview} {report.flaggedForReview} · {l.outcomeNew} {report.new} ·{" "}
        {l.outcomeSkippedOwnCompany} {report.ownCompanySkipped + ownCompanySkippedBeforeMatching}
      </p>
      {report.flaggedForReview > 0 && (
        <p className="muted mb-0">
          <a href="/admin/duplicates">{l.outcomeReviewQueueLink}</a>
        </p>
      )}
    </div>
  );
}

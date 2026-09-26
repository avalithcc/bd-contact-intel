import { getDictionary } from "@/lib/i18n/server";
import { pickContactsImportLabels } from "@/lib/contacts/labels";
import { pickLeadsUploadLabels } from "@/lib/leads/labels";
import { ConnectionsUploadForm } from "./ConnectionsUploadForm";
import { UploadLeadsForm } from "@/app/(app)/leads/UploadLeadsForm";

export const dynamic = "force-dynamic";

/**
 * `/contacts/import` (task 14.2; mockups/import.html): consolidates the two
 * CSV ingestion sources this app has today — LinkedIn connections
 * (`uploadCsv`/`upsertContacts`) and a leads CSV with sources
 * (`importLeadsCsv`/`importLeads`) — behind the SAME identity resolver as
 * the live cutover, each showing its dedup outcome (`ImportOutcome`) after
 * a run. Both underlying actions/queries are unchanged; this page is a new
 * front door for them, not a rewrite. The pre-existing upload controls on
 * `/` (LinkedIn) and `/leads` (leads CSV) are left in place — see tasks.md
 * 14.2 for the "moves" vs. "adds" scope note.
 */
export default async function ContactsImportPage() {
  const dict = await getDictionary();
  const l = pickContactsImportLabels(dict);
  const leadsLabels = pickLeadsUploadLabels(dict);

  return (
    <main>
      <div className="page-header">
        <h1>{l.pageTitle}</h1>
        <p className="meta">{l.subtitle}</p>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>{l.connectionsCardTitle}</h3>
          </div>
          <div className="card-body">
            <ConnectionsUploadForm labels={l} />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>{l.leadsCardTitle}</h3>
          </div>
          <div className="card-body">
            <UploadLeadsForm labels={leadsLabels} outcomeLabels={l} />
          </div>
        </div>
      </div>
    </main>
  );
}

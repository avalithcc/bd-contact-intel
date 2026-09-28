import { getDictionary } from "@/lib/i18n/server";
import { pickContactsImportLabels } from "@/lib/contacts/labels";
import { pickLeadsUploadLabels } from "@/lib/leads/labels";
import { UploadLeadsForm } from "@/app/(app)/leads/UploadLeadsForm";

// NOTE: `ConnectionsUploadForm` (LinkedIn connections import, `uploadCsv`)
// is intentionally hidden here — the owner is not using LinkedIn ingestion
// for now. The action, parser and identity-resolver write path are untouched;
// re-add `import { ConnectionsUploadForm } from "./ConnectionsUploadForm";`
// and render its card again (see git history of this file) to bring it back.

export const dynamic = "force-dynamic";

/**
 * `/contacts/import` (task 14.2; mockups/import.html): front door for the
 * leads CSV ingestion source (`importLeadsCsv`/`importLeads`), behind the
 * same identity resolver as the live cutover, showing its dedup outcome
 * (`ImportOutcome`) after a run. This page also used to host the LinkedIn
 * connections upload (`ConnectionsUploadForm`/`uploadCsv`) side by side with
 * the leads card; that card is hidden for now (LinkedIn ingestion is not in
 * use) — see the NOTE above the imports to restore it.
 */
export default async function ContactsImportPage() {
  const dict = await getDictionary();
  const l = pickContactsImportLabels(dict);
  const leadsLabels = pickLeadsUploadLabels(dict);

  return (
    <main>
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{l.eyebrow}</div>
          <h1>
            {l.pageTitle}
            <span className="dot">.</span>
          </h1>
          <p className="meta">{l.subtitle}</p>
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
    </main>
  );
}

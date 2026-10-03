import { getDictionary } from "@/lib/i18n/server";
import { pickContactsImportLabels } from "@/lib/contacts/labels";
import { pickLeadsUploadLabels } from "@/lib/leads/labels";
import { UploadLeadsForm } from "@/app/(app)/leads/UploadLeadsForm";
import { ConnectionsUploadForm } from "./ConnectionsUploadForm";

export const dynamic = "force-dynamic";

/**
 * `/contacts/import` (task 14.2; mockups/import.html): front door for the
 * leads CSV ingestion source (`importLeadsCsv`/`importLeads`), behind the
 * same identity resolver as the live cutover, showing its dedup outcome
 * (`ImportOutcome`) after a run. This page also used to host the LinkedIn
 * connections upload (`ConnectionsUploadForm`/`uploadCsv`) side by side with
 * the leads card, shown again below (linkedin-import-visible mockup, screen
 * 3). Both feed the shared `person` table, so the whole team sees what is
 * imported here; LinkedIn MESSAGES are private per BD and import from
 * `/account/linkedin-messages` instead.
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
          <h3>{l.connectionsCardTitle}</h3>
        </div>
        <div className="card-body">
          <ConnectionsUploadForm labels={l} />
        </div>
      </div>

      <div className="card mt-lg">
        <div className="card-header">
          <h3>{l.leadsCardTitle}</h3>
        </div>
        <div className="card-body">
          <UploadLeadsForm labels={leadsLabels} outcomeLabels={l} />
        </div>
      </div>

      <p className="help mt-md">{l.sharedVisibilityNote}</p>
    </main>
  );
}

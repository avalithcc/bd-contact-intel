import Link from "next/link";
import { getDictionary } from "@/lib/i18n/server";
import { listNeverLogEntriesAction } from "../neverLogActions";
import { NeverLogManager } from "./NeverLogManager";

export const dynamic = "force-dynamic";

/**
 * /account/email/never-log (email-sync.html screen 3; README decision 2 —
 * its own route under the Gmail connection page, decision 3 — strictly
 * per-BD self-service).
 */
export default async function NeverLogPage() {
  const [entries, dict] = await Promise.all([listNeverLogEntriesAction(), getDictionary()]);
  const l = dict.accountEmailNeverLog;
  const accountEmailL = dict.accountEmail;

  return (
    <main className="page page-narrow">
      <nav className="breadcrumbs" aria-label="Ruta de navegación">
        <Link href="/account">{accountEmailL.breadcrumbAccount}</Link>
        <span className="sep">/</span>
        <Link href="/account/email">{accountEmailL.breadcrumbGmail}</Link>
        <span className="sep">/</span>
        <span>{l.breadcrumbNeverLog}</span>
      </nav>

      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{l.eyebrow}</div>
          <h1>
            {l.title}
            <span className="dot">.</span>
          </h1>
          <p className="meta">{l.subtitle}</p>
        </div>
      </div>

      <NeverLogManager initialEntries={entries} labels={l} />
    </main>
  );
}

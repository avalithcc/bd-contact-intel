import Link from "next/link";
import { getCurrentBd, getMessageImportStats } from "@/lib/queries";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { formatArgentinaDayMonth } from "@/lib/i18n/format";
import { UploadMessagesForm } from "@/app/UploadForm";

export const dynamic = "force-dynamic";

/**
 * `/account/linkedin-messages` (linkedin-import-visible mockup, screen 2).
 * Upload for LinkedIn's `messages.csv` export (`uploadMessagesCsv`). It lives
 * under the BD's own account because conversations are keyed by
 * `conversation.bd_id` and private per BD; the stats shown are the signed-in
 * BD's only (`getMessageImportStats` scopes every count by `bd_id`).
 *
 * Privacy line: only the owner reads these messages in the app
 * (`getConversationThreads` filters by `bdId`); the sole bypass is
 * `getConversationForAdmin`, which writes an `audit_log` row whenever the
 * admin is not the owner (`shouldAuditConversationView`).
 */
export default async function LinkedinMessagesPage() {
  const [me, dict, locale] = await Promise.all([getCurrentBd(), getDictionary(), getLocale()]);
  const l = dict.accountLinkedinMessages;
  const stats = await getMessageImportStats(me.id);
  const numberFormat = new Intl.NumberFormat("es-AR");

  return (
    <main className="page page-narrow">
      <nav className="breadcrumbs mb-md" aria-label="Ruta de navegación">
        <Link href="/account">{l.breadcrumbAccount}</Link>
        <span className="sep">/</span>
        <span>{l.breadcrumbCurrent}</span>
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

      <div className="card">
        <div className="card-header">
          <h3>{l.cardTitle}</h3>
        </div>
        <div className="card-body">
          <p className="help">{l.privacy}</p>
          <div className="row row-lg mt-md">
            <div className="grow">
              <span className="label">{l.statsLabel}</span>
              <p className="meta">
                {stats.lastImportedAt
                  ? l.statsMeta(
                      numberFormat.format(stats.messageCount),
                      numberFormat.format(stats.conversationCount),
                      formatArgentinaDayMonth(stats.lastImportedAt),
                    )
                  : l.statsEmpty}
              </p>
            </div>
          </div>
          <div className="hr"></div>
          <div className="mt-md">
            <UploadMessagesForm locale={locale} />
            <p className="help mt-md">{l.fileHelp}</p>
          </div>
        </div>
      </div>
    </main>
  );
}

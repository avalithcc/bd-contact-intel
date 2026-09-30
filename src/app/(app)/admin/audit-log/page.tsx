import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { listConversationAuditLog } from "@/lib/activity/auditLogQueries";
import { resolvePage } from "@/lib/pagination";
import { es } from "@/lib/i18n/dictionaries/es";
import { formatDateTime } from "@/lib/i18n/format";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { InfoIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

// Spanish-only regardless of `locale`, same rationale as /admin/duplicates
// and /admin/migration (design D10, R11).
const dict = es.auditLog;

/**
 * Administración → Registro de auditoría (admin-conversation-access mockup,
 * screen 3: admin-conversation.html:310-355). Scoped to `view_conversation`
 * entries only (owner decision, 2026-09-30) — merges/unmerges keep their own
 * history table at /admin/duplicates#history. No retention window: shows
 * everything, paginated (owner decision — the mockup's "últimos 90 días" is
 * dropped).
 */
export default async function AuditLogAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  try {
    await requireAdmin();
  } catch (err) {
    // Admin screens 404 for non-admins, not 403 (design.md "Routes") — same
    // convention as /admin/duplicates and /admin/migration.
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }

  const { page: pageParam } = await searchParams;
  const page = resolvePage(pageParam);
  const { rows, total, totalPages } = await listConversationAuditLog(page, PAGE_SIZE);
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <main>
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{dict.eyebrow}</div>
          <h1>
            {dict.title}
            <span className="dot">.</span>
          </h1>
          <p className="meta">{dict.subtitle}</p>
        </div>
      </div>

      <div className="alert alert-info">
        <InfoIcon className="icon" />
        <div>
          {dict.noteBodyPrefix} {dict.noteBodyBeforeLink}{" "}
          <Link href="/admin/duplicates#history">{dict.noteLinkText}</Link>.
        </div>
      </div>

      <div className="card mt-xl">
        <div className="card-header">
          <h3>{dict.cardTitle}</h3>
        </div>
        {rows.length === 0 ? (
          <div className="card-body">
            <p className="muted">{dict.emptyState}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{dict.colWhen}</th>
                  <th>{dict.colAdmin}</th>
                  <th>{dict.colContact}</th>
                  <th>{dict.colConversationOf}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="meta">{formatDateTime(row.at, "es")}</td>
                    <td>
                      <span className="owner-chip">
                        <Avatar id={row.actorBdId} initials={initialsFromName(row.actorName)} variant="bd" size="sm" />
                        {row.actorName}
                      </span>
                    </td>
                    <td>
                      {row.personId ? (
                        <Link className="strong" href={`/contacts/${row.personId}`}>
                          {row.personName ?? "—"}
                        </Link>
                      ) : (
                        <span className="soft">{row.personName ?? "—"}</span>
                      )}
                    </td>
                    <td>
                      {row.targetBdId && row.targetBdName ? (
                        <span className="owner-chip">
                          <Avatar id={row.targetBdId} initials={initialsFromName(row.targetBdName)} variant="bd" size="sm" />
                          {row.targetBdName}
                        </span>
                      ) : (
                        <span className="soft">—</span>
                      )}
                    </td>
                    <td className="right">
                      {row.personId && row.targetBdId && (
                        <Link
                          className="btn btn-secondary btn-sm"
                          href={`/contacts/${row.personId}/conversation/${row.targetBdId}`}
                          prefetch={false}
                        >
                          {dict.openAction}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="table-footer">
              <span>{dict.showingRange(from, to, total)}</span>
              <div className="row">
                {page > 1 && (
                  <Link href={`/admin/audit-log?page=${page - 1}`} className="btn btn-secondary btn-sm">
                    {dict.prevPage}
                  </Link>
                )}
                <span>{dict.pageOf(page, totalPages)}</span>
                {page < totalPages && (
                  <Link href={`/admin/audit-log?page=${page + 1}`} className="btn btn-secondary btn-sm">
                    {dict.nextPage}
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

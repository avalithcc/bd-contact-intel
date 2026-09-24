import { notFound } from "next/navigation";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getLatestMigrationRun, listMigrationRuns } from "@/lib/migration/queries";
import type { CollapseReport } from "@/lib/migration/collapsePlanner";
import { es } from "@/lib/i18n/dictionaries/es";
import { formatDateTime } from "@/lib/i18n/format";
import { approveMigrationRunAction } from "./actions";

export const dynamic = "force-dynamic";

// New admin screens are Spanish-only regardless of the visitor's `locale`
// cookie (design D10, R11 — the switcher and `en` usage path are removed
// app-wide in PR 8; this page adopts the target language now rather than
// later). See src/lib/i18n/dictionaries/en.ts#migration for why the
// English half of this dictionary section still exists in the meantime.
const dict = es.migration;

function isCollapseReport(report: unknown): report is CollapseReport {
  return !!report && typeof report === "object" && "contact" in report && "persons" in report;
}

/**
 * `finalizeExecute` (queries.ts) folds `backupPath` into the existing
 * jsonb `report` column rather than adding a dedicated migration_run
 * column — see that function's comment. Duck-typed here since it's only
 * present once a run has actually been executed.
 */
function backupPathFrom(report: unknown): string | null {
  if (!report || typeof report !== "object") return null;
  const path = (report as { backupPath?: unknown }).backupPath;
  return typeof path === "string" ? path : null;
}

export default async function MigrationAdminPage() {
  try {
    await requireAdmin();
  } catch (err) {
    // Admin screens 404 for non-admins rather than 403 — their existence
    // is not meant to be discoverable (design.md "Routes").
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }

  const [latest, history] = await Promise.all([
    getLatestMigrationRun("collapse"),
    listMigrationRuns("collapse"),
  ]);

  return (
    <main>
      <div className="eyebrow">{dict.eyebrow}</div>
      <h1 className="m-0">{dict.title}</h1>
      <p className="soft">{dict.subtitle}</p>

      {!latest && <p className="muted">{dict.noRuns}</p>}

      {latest && (
        <>
          <p className="soft">
            {dict.generatedAt(formatDateTime(latest.createdAt, "es"))}
            {" · "}
            {dict.inputHash(latest.inputHash.slice(0, 12))}
          </p>

          {!latest.executedAt && (
            <section className="panel">
              <strong>{dict.notExecutedWarning}</strong>
            </section>
          )}

          {isCollapseReport(latest.report) && (
            <section className="panel">
              <div className="eyebrow">{dict.reportTitle}</div>
              <div className="table-wrap">
                <table>
                  <tbody>
                    <tr>
                      <td>{dict.tableRowsRead}</td>
                      <td>{latest.report.contact.rowsRead}</td>
                    </tr>
                    <tr>
                      <td>{dict.tableOwnCompanySkipped}</td>
                      <td>{latest.report.contact.ownCompanySkipped}</td>
                    </tr>
                    <tr>
                      <td>{dict.tableAutoMerged}</td>
                      <td>{latest.report.contact.autoMergedByProfileKey}</td>
                    </tr>
                    <tr>
                      <td>{dict.tableFlaggedForReview}</td>
                      <td>{latest.report.contact.flaggedForReview}</td>
                    </tr>
                    <tr>
                      <td>{dict.tableNewPersons}</td>
                      <td>{latest.report.contact.new}</td>
                    </tr>
                    <tr>
                      <td>{dict.tableMultiBd}</td>
                      <td>{latest.report.persons.multiBd}</td>
                    </tr>
                    <tr>
                      <td>{dict.tableTotalConnections}</td>
                      <td>{latest.report.connections.total}</td>
                    </tr>
                    <tr>
                      <td>{dict.tableUnparseableDates}</td>
                      <td>{latest.report.connections.unparseableConnectedOn}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="panel">
            {latest.approvedAt ? (
              <p className="soft">
                {dict.approvedBy(
                  latest.approverName ?? "—",
                  formatDateTime(latest.approvedAt, "es"),
                )}
              </p>
            ) : (
              <form action={approveMigrationRunAction}>
                <input type="hidden" name="runId" value={latest.id} />
                <button type="submit" className="filter-submit">
                  {dict.approveButton}
                </button>
              </form>
            )}
            {latest.executedAt && (
              <p className="soft">{dict.executedAt(formatDateTime(latest.executedAt, "es"))}</p>
            )}
            {backupPathFrom(latest.report) && (
              <p className="muted">{dict.backupPath(backupPathFrom(latest.report)!)}</p>
            )}
          </section>
        </>
      )}

      {history.length > 0 && (
        <section className="panel">
          <div className="eyebrow">{dict.historyTitle}</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{dict.historyRun}</th>
                  <th>{dict.historyMode}</th>
                  <th>{dict.historyStatus}</th>
                  <th>{dict.historyApprovedBy}</th>
                  <th>{dict.historyWhen}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((run) => (
                  <tr key={run.id}>
                    <td>{run.id.slice(0, 8)}</td>
                    <td>{run.mode === "dry_run" ? dict.modeDryRun : dict.modeExecute}</td>
                    <td>
                      {run.executedAt
                        ? dict.statusExecuted
                        : run.approvedAt
                          ? dict.statusApproved
                          : dict.statusPending}
                    </td>
                    <td>{run.approverName ?? "—"}</td>
                    <td>{formatDateTime(run.createdAt, "es")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

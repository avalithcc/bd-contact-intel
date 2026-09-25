import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import {
  getLatestMigrationRun,
  listMigrationRuns,
  type MigrationRunWithApprover,
} from "@/lib/migration/queries";
import type { CollapseReport } from "@/lib/migration/collapsePlanner";
import type { FoldReport } from "@/lib/migration/foldPlanner";
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

function isFoldReport(report: unknown): report is FoldReport {
  return !!report && typeof report === "object" && "lead" in report && "persons" in report;
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

function CollapseReportTable({ report }: { report: CollapseReport }) {
  return (
    <div className="table-wrap">
      <table>
        <tbody>
          <tr>
            <td>{dict.tableRowsRead}</td>
            <td>{report.contact.rowsRead}</td>
          </tr>
          <tr>
            <td>{dict.tableOwnCompanySkipped}</td>
            <td>{report.contact.ownCompanySkipped}</td>
          </tr>
          <tr>
            <td>{dict.tableAutoMerged}</td>
            <td>{report.contact.autoMergedByProfileKey}</td>
          </tr>
          <tr>
            <td>{dict.tableFlaggedForReview}</td>
            <td>{report.contact.flaggedForReview}</td>
          </tr>
          <tr>
            <td>{dict.tableNewPersons}</td>
            <td>{report.contact.new}</td>
          </tr>
          <tr>
            <td>{dict.tableMultiBd}</td>
            <td>{report.persons.multiBd}</td>
          </tr>
          <tr>
            <td>{dict.tableTotalConnections}</td>
            <td>{report.connections.total}</td>
          </tr>
          <tr>
            <td>{dict.tableUnparseableDates}</td>
            <td>{report.connections.unparseableConnectedOn}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function FoldReportTable({ report }: { report: FoldReport }) {
  return (
    <div className="table-wrap">
      <table>
        <tbody>
          <tr>
            <td>{dict.tableLeadRowsRead}</td>
            <td>{report.lead.rowsRead}</td>
          </tr>
          <tr>
            <td>{dict.tableLeadOwnCompanySkipped}</td>
            <td>{report.lead.ownCompanySkipped}</td>
          </tr>
          <tr>
            <td>{dict.tableLeadAutoMerged}</td>
            <td>{report.lead.autoMerged}</td>
          </tr>
          <tr>
            <td>{dict.tableLeadFlaggedForReview}</td>
            <td>{report.lead.flaggedForReview}</td>
          </tr>
          <tr>
            <td>{dict.tableLeadNew}</td>
            <td>{report.lead.new}</td>
          </tr>
          <tr>
            <td>{dict.tableStatusBackfilled}</td>
            <td>{report.lead.statusBackfilled}</td>
          </tr>
          <tr>
            <td>{dict.tablePersonsCreated}</td>
            <td>{report.persons.created}</td>
          </tr>
          <tr>
            <td>{dict.tablePersonsUpdated}</td>
            <td>{report.persons.updated}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** One kind's panel: latest run (report + approve action) plus its history. */
function MigrationKindSection({
  kind,
  sectionTitle,
  reportTitle,
  latest,
  history,
  renderReport,
}: {
  kind: "collapse" | "fold_leads";
  sectionTitle: string;
  reportTitle: string;
  latest: MigrationRunWithApprover | null;
  history: MigrationRunWithApprover[];
  renderReport: (report: unknown) => ReactNode;
}) {
  return (
    <section>
      <div className="eyebrow">{sectionTitle}</div>

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

          <section className="panel">
            <div className="eyebrow">{reportTitle}</div>
            {renderReport(latest.report)}
          </section>

          <section className="panel">
            {latest.approvedAt ? (
              <p className="soft">
                {dict.approvedBy(latest.approverName ?? "—", formatDateTime(latest.approvedAt, "es"))}
              </p>
            ) : (
              <form action={approveMigrationRunAction}>
                <input type="hidden" name="runId" value={latest.id} />
                <input type="hidden" name="kind" value={kind} />
                <button type="submit" className="filter-submit">
                  {dict.approveButton}
                </button>
              </form>
            )}
            {latest.executedAt && <p className="soft">{dict.executedAt(formatDateTime(latest.executedAt, "es"))}</p>}
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
    </section>
  );
}

function isApproveErrorReason(v: string | undefined): v is keyof typeof dict.approveErrors {
  return !!v && v in dict.approveErrors;
}

export default async function MigrationAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ approveError?: string }>;
}) {
  try {
    await requireAdmin();
  } catch (err) {
    // Admin screens 404 for non-admins rather than 403 — their existence
    // is not meant to be discoverable (design.md "Routes").
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }

  const [{ approveError }, collapseLatest, collapseHistory, foldLatest, foldHistory] = await Promise.all([
    searchParams,
    getLatestMigrationRun("collapse"),
    listMigrationRuns("collapse"),
    getLatestMigrationRun("fold_leads"),
    listMigrationRuns("fold_leads"),
  ]);

  return (
    <main>
      <div className="eyebrow">{dict.eyebrow}</div>
      <h1 className="m-0">{dict.title}</h1>
      <p className="soft">{dict.subtitle}</p>

      {isApproveErrorReason(approveError) && (
        <section className="panel">
          <strong>{dict.approveErrors[approveError]}</strong>
        </section>
      )}

      <MigrationKindSection
        kind="collapse"
        sectionTitle={dict.sectionCollapseTitle}
        reportTitle={dict.reportTitle}
        latest={collapseLatest}
        history={collapseHistory}
        renderReport={(report) => (isCollapseReport(report) ? <CollapseReportTable report={report} /> : null)}
      />

      <MigrationKindSection
        kind="fold_leads"
        sectionTitle={dict.sectionFoldTitle}
        reportTitle={dict.foldReportTitle}
        latest={foldLatest}
        history={foldHistory}
        renderReport={(report) => (isFoldReport(report) ? <FoldReportTable report={report} /> : null)}
      />
    </main>
  );
}

import { clampRescanCap, RESCAN_DEFAULT_CAP, RESCAN_MAX_CAP, RESCAN_SKIP_REASONS, type RescanReport } from "@/lib/identity/duplicateRescan";
import type { RescanLastRun } from "@/lib/identity/duplicateRescanRun";
import { es } from "@/lib/i18n/dictionaries/es";
import { formatDateTime } from "@/lib/i18n/format";
import { runDuplicateRescanAction } from "./actions";

// Spanish-only regardless of `locale`, same as the rest of this admin screen.
const dict = es.duplicates.rescan;
const fmt = new Intl.NumberFormat("es-AR");

function Stat({ tone, label, value, foot }: { tone: string; label: string; value: string; foot: string }) {
  return (
    <div className={`stat ${tone}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="foot">{foot}</div>
    </div>
  );
}

/** The run's own report: the equation closes (found = created + remaining + skipped) and every skip has a row. */
function RunReport({ report }: { report: RescanReport }) {
  const skippedTotal = RESCAN_SKIP_REASONS.reduce((sum, r) => sum + report.skipped[r], 0);
  const shown = report.dryRun ? report.planned : report.created;
  return (
    <>
      <div className={`alert ${report.dryRun ? "alert-info" : "alert-success"} mb-lg`}>
        <div>
          <div className="title">{report.dryRun ? dict.dryTitle : dict.doneTitle(report.created)}</div>
          {report.dryRun && `${dict.dryBody(report.cap)} `}
          {dict.equation(report.found, shown, report.remaining, skippedTotal, report.dryRun)}
        </div>
      </div>
      {report.remaining > 0 && (
        <div className="alert alert-warn mb-lg">
          <div>
            <div className="title">{dict.cappedTitle(report.found, shown, report.remaining)}</div>
            {dict.cappedBody}
          </div>
        </div>
      )}
      <div className="grid-4 mb-lg">
        <Stat tone="neutral" label={dict.statScanned} value={fmt.format(report.scanned)} foot={dict.statScannedFoot} />
        <Stat tone="info" label={dict.statFound} value={fmt.format(report.found)} foot={dict.statFoundFoot(report.groups)} />
        <Stat tone="success" label={report.dryRun ? dict.statWouldCreate : dict.statCreated} value={fmt.format(shown)} foot={dict.statCreatedFoot} />
        <Stat tone="warn" label={dict.statSkipped} value={fmt.format(skippedTotal)} foot={dict.statSkippedFoot} />
      </div>
      <div className="card mb-lg">
        <div className="card-header">
          <h3>{dict.skippedTitle}</h3>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>{dict.colReason}</th>
              <th className="right">{dict.colPairs}</th>
              <th>{dict.colWhat}</th>
            </tr>
          </thead>
          <tbody>
            {RESCAN_SKIP_REASONS.filter((r) => report.skipped[r] > 0).map((r) => (
              <tr key={r}>
                <td>
                  <span className="badge badge-neutral no-dot">{dict.skipReasons[r]![0]}</span>
                </td>
                <td className="right num">{report.skipped[r]}</td>
                <td className="soft">{dict.skipReasons[r]![1]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="table-footer">
          <span>{[report.ownCompanyPersons > 0 ? dict.ownCompanyNote(report.ownCompanyPersons) : null, dict.closedNote].filter(Boolean).join(" ")}</span>
        </div>
      </div>
    </>
  );
}

export function RescanPanel({ lastRun, report }: { lastRun: RescanLastRun | null; report: RescanReport | null }) {
  const cap = clampRescanCap(report?.cap ?? lastRun?.cap ?? RESCAN_DEFAULT_CAP);
  const badge = !lastRun ? dict.badgeNever : lastRun.remaining > 0 ? dict.badgeCapped : dict.badgeComplete;
  return (
    <>
      <div className="card mb-lg">
        <div className="card-header">
          <h3>{dict.title}</h3>
          <span className="actions">
            <span className={`badge ${!lastRun ? "badge-outline" : lastRun.remaining > 0 ? "badge-warn" : "badge-success"} no-dot`}>{badge}</span>
          </span>
        </div>
        <div className="card-body">
          <p className="soft">{dict.intro}</p>
          {lastRun && lastRun.remaining > 0 && <div className="alert alert-warn mt-lg"><div>{dict.lastRunRemaining(lastRun.remaining)}</div></div>}
          <div className="grid-3 mt-lg">
            <Stat
              tone="neutral"
              label={dict.lastRun}
              value={lastRun ? formatDateTime(lastRun.at, "es") : dict.never}
              foot={lastRun ? dict.lastRunFoot(lastRun.trigger === "cron" ? dict.triggerCron : dict.triggerManual, lastRun.actorName) : dict.neverFoot}
            />
            <Stat tone="neutral" label={dict.how} value={lastRun ? (lastRun.trigger === "cron" ? dict.triggerCron : dict.triggerManual) : "—"} foot={dict.howFoot} />
            <Stat tone="neutral" label={dict.created} value={lastRun ? String(lastRun.created) : "—"} foot={dict.createdFoot} />
          </div>
          <hr className="hr" />
          <form className="row" action={runDuplicateRescanAction}>
            <div className="field">
              <label className="label" htmlFor="cap">
                {dict.capLabel}
              </label>
              <input id="cap" className="input input-sm" name="cap" type="number" min={1} max={RESCAN_MAX_CAP} defaultValue={cap} aria-describedby="cap-help" />
            </div>
            <label className="check">
              <input type="checkbox" name="dryRun" defaultChecked /> {dict.dryRunLabel}
            </label>
            <span className="grow"></span>
            <button type="submit" className="btn btn-primary">
              {dict.button}
            </button>
          </form>
          <p className="help mt-md" id="cap-help">
            {dict.capHelp(RESCAN_MAX_CAP)}
          </p>
        </div>
      </div>
      {report && <RunReport report={report} />}
    </>
  );
}

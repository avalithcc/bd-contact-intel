import {
  getDiscoveryStatusCounts,
  getLastDiscoveryRun,
  getPendingCandidates,
} from "@/lib/hiring/discoveryQueries";
import { linkedinCompanySearchUrl } from "@/lib/links";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";
import { approveCandidate, rejectCandidate } from "./actions";

export const dynamic = "force-dynamic";

// This page reads shared, cross-BD data only (board_candidate and
// discovery_run have no bd_id — see src/db/schema.ts). It intentionally
// takes no BD identity of its own to scope the three queries below.
// contactCount on each candidate is an aggregate across ALL BDs, never the
// viewing BD's own count; see the copy in src/lib/i18n/dictionaries.
export default async function DiscoveryPage() {
  const locale = await getLocale();
  const dict = t(locale);

  const [candidates, counts, lastRun] = await Promise.all([
    getPendingCandidates(),
    getDiscoveryStatusCounts(),
    getLastDiscoveryRun(),
  ]);

  return (
    <main>
      {/* The page-local logo/header and cross-link nav row (BackButton +
          Novedades/Vacantes/Contactos secondary-btns) were removed here
          (mockup-parity 6.1) — the app shell ((app)/layout.tsx -> Sidebar
          + TopBar breadcrumb) already covers both. */}
      <div className="mb-3xl">
        <div className="eyebrow">{dict.discovery.eyebrow}</div>
        <h1>
          {dict.discovery.title}
          <span className="dot">.</span>
        </h1>
        <p className="soft m-0">
          {dict.discovery.subtitle}
        </p>
      </div>

      <section className="panel">
        <div className="eyebrow">{dict.discovery.lastRunEyebrow}</div>
        {!lastRun && <p className="muted">{dict.discovery.noRunsYet}</p>}
        {lastRun && (
          <p className="soft m-0">
            {dict.discovery.lastRunSummary(
              formatDateTime(lastRun.startedAt, locale),
              lastRun.companiesProbed,
              lastRun.hits,
            )}
            {lastRun.status === "error" && (
              <span className="legacy-badge ml-sm">
                {dict.discovery.lastRunFailed}
              </span>
            )}
            {!lastRun.finishedAt && (
              <span className="legacy-badge ml-sm">
                {dict.discovery.lastRunUnfinished}
              </span>
            )}
          </p>
        )}
        {lastRun?.error && (
          <p className="muted mt-2xs">
            {lastRun.error}
          </p>
        )}
        <p className="soft mt-md mb-0">
          {dict.discovery.statusCounts(counts.pending, counts.approved, counts.rejected)}
        </p>
      </section>

      <section className="panel">
        <div className="eyebrow">{dict.discovery.queueEyebrow}</div>
        {!candidates.length && <p className="muted">{dict.discovery.queueEmpty}</p>}

        {candidates.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{dict.discovery.tableCompany}</th>
                  <th>{dict.discovery.tableBoard}</th>
                  <th>{dict.discovery.tableJobs}</th>
                  <th>{dict.discovery.tableSampleTitles}</th>
                  <th>{dict.discovery.tableMarkets}</th>
                  <th>{dict.discovery.tableContacts}</th>
                  <th>{dict.discovery.tableActions}</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <a
                        href={linkedinCompanySearchUrl(c.displayName)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={dict.discovery.openOnLinkedIn}
                      >
                        {c.displayName}
                      </a>
                    </td>
                    <td>
                      <a href={c.boardUrl} target="_blank" rel="noopener noreferrer">
                        {c.ats}/{c.slug}
                      </a>
                    </td>
                    <td>{c.jobCount}</td>
                    <td>
                      {c.sampleTitles.length ? (
                        <ul className="example-list">
                          {c.sampleTitles.map((title, i) => (
                            <li key={i}>{title}</li>
                          ))}
                        </ul>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {c.markets.length
                        ? c.markets.map((m) => dict.markets[m]).join(" / ")
                        : dict.discovery.marketsUnknown}
                    </td>
                    <td>{dict.discovery.teamContactCount(c.contactCount)}</td>
                    <td>
                      <div className="legacy-row legacy-row-xs">
                        <form action={approveCandidate}>
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="secondary-btn">
                            {dict.discovery.approve}
                          </button>
                        </form>
                        <form action={rejectCandidate}>
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="secondary-btn">
                            {dict.discovery.reject}
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

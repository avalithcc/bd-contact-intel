import Link from "next/link";
import {
  getDiscoveryStatusCounts,
  getLastDiscoveryRun,
  getPendingCandidates,
} from "@/lib/hiring/discoveryQueries";
import { getCurrentBd } from "@/lib/queries";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";
import { LocaleSwitcher } from "@/lib/i18n/LocaleSwitcher";
import { SignOutButton } from "../SignOutButton";
import { UserMenu } from "../UserMenu";
import { approveCandidate, rejectCandidate } from "./actions";

export const dynamic = "force-dynamic";

// This page reads shared, cross-BD data only (board_candidate and
// discovery_run have no bd_id — see src/db/schema.ts). getCurrentBd() below
// is used only to label the header's user menu — it deliberately is NOT
// passed into any of the three queries below to scope them.
// contactCount on each candidate is an aggregate across ALL BDs, never the
// viewing BD's own count; see the copy in src/lib/i18n/dictionaries.
export default async function DiscoveryPage() {
  const locale = await getLocale();
  const dict = t(locale);
  const me = await getCurrentBd();

  const [candidates, counts, lastRun] = await Promise.all([
    getPendingCandidates(),
    getDiscoveryStatusCounts(),
    getLastDiscoveryRun(),
  ]);

  return (
    <main>
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
        <div className="row" style={{ gap: "0.75rem" }}>
          <Link className="secondary-btn" href="/">
            {dict.common.backToContacts}
          </Link>
          <Link className="secondary-btn" href="/whats-new">
            {dict.common.whatsNew}
          </Link>
          <Link className="secondary-btn" href="/hiring">
            {dict.common.hiringSignals}
          </Link>
          <UserMenu
            label={me.name || dict.common.account}
            changePasswordHref="/account/password"
            changePasswordLabel={dict.common.changePassword}
            localeSwitcher={<LocaleSwitcher locale={locale} />}
            signOutButton={<SignOutButton locale={locale} />}
          />
        </div>
      </div>

      <div style={{ marginBottom: "1.75rem" }}>
        <div className="eyebrow">{dict.discovery.eyebrow}</div>
        <h1>
          {dict.discovery.title}
          <span className="dot">.</span>
        </h1>
        <p className="soft" style={{ margin: 0 }}>
          {dict.discovery.subtitle}
        </p>
      </div>

      <section className="panel">
        <div className="eyebrow">{dict.discovery.lastRunEyebrow}</div>
        {!lastRun && <p className="muted">{dict.discovery.noRunsYet}</p>}
        {lastRun && (
          <p className="soft" style={{ margin: 0 }}>
            {dict.discovery.lastRunSummary(
              formatDateTime(lastRun.startedAt, locale),
              lastRun.companiesProbed,
              lastRun.hits,
            )}
            {lastRun.status === "error" && (
              <span className="badge" style={{ marginLeft: "0.5rem" }}>
                {dict.discovery.lastRunFailed}
              </span>
            )}
            {!lastRun.finishedAt && (
              <span className="badge" style={{ marginLeft: "0.5rem" }}>
                {dict.discovery.lastRunUnfinished}
              </span>
            )}
          </p>
        )}
        {lastRun?.error && (
          <p className="muted" style={{ marginTop: "0.35rem" }}>
            {lastRun.error}
          </p>
        )}
        <p className="soft" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
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
                    <td>{c.displayName}</td>
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
                      <div className="row" style={{ gap: "0.4rem" }}>
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

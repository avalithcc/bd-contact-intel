import { notFound } from "next/navigation";
import { CheckCircleIcon, InfoIcon } from "@/components/icons";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getGmailFleetHealth } from "@/lib/gmail/fleetQueries";
import { formatInstant } from "@/lib/gmail/fleetFormat";
import { fleetAlerts } from "@/lib/gmail/fleetText";
import { FLEET_FILTERS, filterFleet, parseFleetFilter, summarizeFleet, type FleetFilter } from "@/lib/gmail/fleetView";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { FleetLink } from "./FleetLink";
import { FleetTable } from "./FleetTable";

export const dynamic = "force-dynamic";

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
const hrefFor = (filter: FleetFilter) => (filter === "all" ? "/admin/gmail" : `/admin/gmail?filter=${filter}`);

/**
 * Administración → Estado de Gmail (gmail-sync-fleet; mockups/estado-gmail-equipo.html). One row per BD with the state of its
 * Gmail connection, so a sync that falls over is seen by the owner and not only by its BD. One read, getGmailFleetHealth
 * (fleetQueries.ts); the meaning of every cell is decided in fleetView.ts / fleetText.ts. Non-admins get a 404, like every
 * admin screen. Viewing is not audited (audit_log is for consequential actions only).
 */
export default async function GmailFleetPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }
  const filter = parseFleetFilter((await searchParams).filter);
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const d = dict.gmailFleet;
  const now = new Date();
  const fleet = await getGmailFleetHealth(now);
  const summary = summarizeFleet(fleet);
  const rows = filterFleet(fleet, filter);
  const alerts = fleetAlerts(fleet, d, now, locale);
  const filterNames: Record<FleetFilter, string> = { all: d.filterAll, attention: d.filterAttention, healthy: d.filterHealthy };

  return (
    <main className="page">
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{d.eyebrow}</div>
          <h1>
            {d.title}
            <span className="dot">.</span>
          </h1>
          <p className="meta">{d.subtitle}</p>
        </div>
        <div className="actions">
          <span className="meta nowrap">{fill(d.updated, { when: formatInstant(now, now, d.time) })}</span>
          <FleetLink href={hrefFor(filter)} className="btn btn-sm">
            {d.refresh}
          </FleetLink>
        </div>
      </div>

      <div className="grid-4 mb-lg">
        <div className="stat success">
          <div className="label">{d.statHealthy}</div>
          <div className="value">
            {summary.healthy}
            <span className="meta"> {fill(d.statHealthyOf, { n: summary.total })}</span>
          </div>
          <div className="foot">{d.statHealthyFoot}</div>
        </div>
        <div className="stat warn">
          <div className="label">{d.statReconnect}</div>
          <div className="value">{summary.reconnect}</div>
          <div className="foot">{d.statReconnectFoot}</div>
        </div>
        <div className="stat warn">
          <div className="label">{d.statFailing}</div>
          <div className="value">{summary.failing}</div>
          <div className="foot">{d.statFailingFoot}</div>
        </div>
        <div className="stat neutral">
          <div className="label">{d.statNever}</div>
          <div className="value">{summary.never}</div>
          <div className="foot">{d.statNeverFoot}</div>
        </div>
      </div>

      {alerts.map((a) => (
        <div key={a.bdId} className={`alert alert-${a.tone} mb-lg`} role="note">
          <InfoIcon className="icon" />
          <div>
            <div className="title">{a.title}</div>
            {a.body}
          </div>
        </div>
      ))}

      <div className="toolbar">
        <div className="segmented" role="group" aria-label={d.filterLabel}>
          {FLEET_FILTERS.map((f) => (
            <FleetLink key={f} href={hrefFor(f)} className={f === filter ? "on" : ""} current={f === filter}>
              {filterNames[f]}
            </FleetLink>
          ))}
        </div>
        <div className="spacer" />
        <span className="meta">{fill(d.count, { n: rows.length })}</span>
      </div>

      {rows.length > 0 ? (
        <FleetTable rows={rows} d={d} now={now} locale={locale} />
      ) : (
        <div className="card mt-xl">
          <div className="empty">
            <div className="empty-icon">
              <CheckCircleIcon className="icon icon-lg" />
            </div>
            <h3>{filter === "attention" ? d.emptyTitle : d.emptyNoneTitle}</h3>
            <p>{filter === "attention" ? d.emptyBody : d.emptyNoneBody}</p>
            <FleetLink href="/admin/gmail" className="btn btn-sm">
              {d.emptyAction}
            </FleetLink>
          </div>
        </div>
      )}
    </main>
  );
}

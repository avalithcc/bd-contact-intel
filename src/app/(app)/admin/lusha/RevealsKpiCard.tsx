"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { KpiDrilldownCard } from "@/app/(app)/admin/reports/KpiDrilldownCard";
import type { ClientStrings } from "@/lib/i18n/clientStrings";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { formatArgentinaDayMonthYear, relativeTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import { drilldownCacheKey } from "@/lib/reports/drilldownCacheKey";
import type { ReportPeriod } from "@/lib/lusha/usageReport";
import type { RevealDrilldownRow } from "@/lib/lusha/revealsDrilldown";
import { getRevealsDrilldownAction } from "./actions";

// ClientStrings-wrapped on purpose: importing a dictionary module into a "use client" file bundles all of it into the client
// chunk and has caused production crashes (see clientStrings.ts). Plain strings only; the page fills the templates.
export type RevealsKpiCardLabels = ClientStrings<
  Pick<
    Dictionary["lushaAdmin"],
    | "statReveals"
    | "revealsDialogTitle"
    | "revealsColContact"
    | "revealsColField"
    | "revealsColActor"
    | "revealsColWhen"
    | "revealsColCredits"
    | "revealsFieldEmail"
    | "revealsFieldPhone"
    | "revealsCreditsPending"
    | "revealsFootnote"
    | "revealsEmpty"
    | "close"
    | "dialogLoading"
    | "dialogError"
    | "dialogTruncated"
    | "numberLocale"
  >
> &
  ClientStrings<Pick<Dictionary["contact"], "unnamed">>;

/**
 * "Revelados" KPI of /admin/lusha: clickable once its value is >= 1, opening the list of reveals the number counts (same
 * period, same filters: getRevealsDrilldown). `subtitle` arrives already filled by the page.
 */
export function RevealsKpiCard({
  value,
  foot,
  period,
  subtitle,
  locale,
  labels: l,
}: {
  value: number;
  foot: React.ReactNode;
  period: ReportPeriod;
  subtitle: string;
  locale: Locale;
  labels: RevealsKpiCardLabels;
}) {
  return (
    <KpiDrilldownCard<RevealDrilldownRow>
      toneClass="info"
      label={l.statReveals}
      value={value}
      foot={foot}
      dialogTitle={l.revealsDialogTitle}
      dialogSubtitle={subtitle}
      xwide
      truncation={{ template: l.dialogTruncated, numberLocale: l.numberLocale }}
      closeLabel={l.close}
      loadingLabel={l.dialogLoading}
      errorLabel={l.dialogError}
      cacheKey={drilldownCacheKey({ kind: "lushaReveals", fromIso: period, bdId: null })}
      fetchRows={() => getRevealsDrilldownAction(period)}
      renderList={(rows) =>
        rows.length === 0 ? (
          <p className="meta">{l.revealsEmpty}</p>
        ) : (
          <>
            <table className="data compact">
              <thead>
                <tr>
                  <th>{l.revealsColContact}</th>
                  <th>{l.revealsColField}</th>
                  <th>{l.revealsColActor}</th>
                  <th>{l.revealsColWhen}</th>
                  <th className="right">{l.revealsColCredits}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.revealId}>
                    <td>
                      <Link href={`/contacts/${r.personId}`}>{r.personName || l.unnamed}</Link>
                      {r.company && <span className="cell-sub">{r.company}</span>}
                    </td>
                    <td>
                      <span className="badge badge-outline no-dot">{r.field === "emails" ? l.revealsFieldEmail : l.revealsFieldPhone}</span>
                      {r.value && <span className="cell-sub mono">{r.value}</span>}
                    </td>
                    <td>
                      <div className="owner-chip">
                        <Avatar id={r.actorBdId} initials={initialsFromName(r.actorBdName)} size="sm" />
                        {r.actorBdName}
                      </div>
                    </td>
                    <td className="nowrap">
                      <span className="soft">{formatArgentinaDayMonthYear(r.at)}</span>
                      <span className="cell-sub">{relativeTime(r.at, locale)}</span>
                    </td>
                    <td className="right">{r.creditsCharged === null ? <span className="soft">{l.revealsCreditsPending}</span> : <span className="num">{r.creditsCharged}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="meta mt-md">{l.revealsFootnote}</p>
          </>
        )
      }
    />
  );
}

"use client";

import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { drilldownCacheKey } from "@/lib/reports/drilldownCacheKey";
import { KpiDrilldownCard } from "./KpiDrilldownCard";
import { getWonCompaniesDrilldownAction } from "./actions";
import type { WonCompanyDrilldownRow } from "@/lib/reports/wonCompaniesDrilldown";
import type { ClientStrings } from "@/lib/i18n/clientStrings";
import type { Dictionary } from "@/lib/i18n/dictionaries";

// ClientStrings-wrapped (review fix: importing the raw `es` dictionary
// module at module scope inside a "use client" file bundled all 1822 lines
// of it into this client chunk, and bypassed the ClientStrings guard that
// exists because passing dictionary objects into client components already
// caused two production crashes — see clientStrings.ts's doc comment). Every
// one of these keys is a plain string in Dictionary["reports"]; picking a
// formatter function here would fail to compile.
export type WonCompaniesKpiCardLabels = ClientStrings<
  Pick<
    Dictionary["reports"],
    | "kpiCompaniesWon"
    | "wonCompaniesDialogTitle"
    | "wonCompaniesDialogSubtitle"
    | "wonCompaniesDialogColCompany"
    | "wonCompaniesDialogColOwner"
    | "wonCompaniesDialogColWonAt"
    | "wonCompaniesDialogWonAtApprox"
    | "wonCompaniesDialogNoOwner"
    | "wonCompaniesDialogFootnote"
    | "wonCompaniesDialogEmpty"
    | "dialogClose"
    | "dialogLoading"
    | "dialogError"
    | "dialogTruncated"
    | "numberLocale"
  >
>;

function wonAtText(row: WonCompanyDrilldownRow, l: WonCompaniesKpiCardLabels): string {
  const date = format(row.wonAt, "d MMM yyyy", { locale: es });
  return row.wonAtExact ? date : `${date} (${l.wonCompaniesDialogWonAtApprox})`;
}

/**
 * "Empresas ganadas" KPI (reports-bd-filter-drilldown, owner request): the
 * card becomes a clickable trigger once its value is >= 1, opening a Dialog
 * with the companies that moved to Ganada in the selected period (same
 * period and BD filter as the number, queries.ts#buildWonCompaniesDrilldownQuery).
 */
export function WonCompaniesKpiCard({
  value,
  foot,
  fromIso,
  toIso,
  bdId,
  labels: l,
}: {
  value: number;
  foot: React.ReactNode;
  fromIso: string;
  toIso: string;
  bdId: string | null;
  labels: WonCompaniesKpiCardLabels;
}) {
  return (
    <KpiDrilldownCard<WonCompanyDrilldownRow>
      toneClass="warn"
      label={l.kpiCompaniesWon}
      value={value}
      foot={foot}
      dialogTitle={l.wonCompaniesDialogTitle}
      dialogSubtitle={l.wonCompaniesDialogSubtitle}
      truncation={{ template: l.dialogTruncated, numberLocale: l.numberLocale }}
      closeLabel={l.dialogClose}
      loadingLabel={l.dialogLoading}
      errorLabel={l.dialogError}
      cacheKey={drilldownCacheKey({ kind: "won", fromIso, toIso, bdId })}
      fetchRows={() => getWonCompaniesDrilldownAction({ fromIso, toIso, bdId })}
      renderList={(rows) =>
        rows.length === 0 ? (
          <p className="meta">{l.wonCompaniesDialogEmpty}</p>
        ) : (
          <>
            <table className="data compact">
              <thead>
                <tr>
                  <th>{l.wonCompaniesDialogColCompany}</th>
                  <th>{l.wonCompaniesDialogColOwner}</th>
                  <th className="right">{l.wonCompaniesDialogColWonAt}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.companyKey}>
                    <td>
                      <Link href={`/companies/${encodeURIComponent(row.companyKey)}`}>{row.displayName}</Link>
                    </td>
                    <td>{row.ownerBdName ?? l.wonCompaniesDialogNoOwner}</td>
                    <td className="right num">{wonAtText(row, l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="meta mt-md">{l.wonCompaniesDialogFootnote}</p>
          </>
        )
      }
    />
  );
}

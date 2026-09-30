"use client";

import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { KpiDrilldownCard } from "./KpiDrilldownCard";
import { getWonCompaniesDrilldownAction } from "./actions";
import type { WonCompanyDrilldownRow } from "@/lib/reports/wonCompaniesDrilldown";
import { es as esDict } from "@/lib/i18n/dictionaries/es";

const dict = esDict.reports;

function wonAtText(row: WonCompanyDrilldownRow): string {
  const date = format(row.wonAt, "d MMM yyyy", { locale: es });
  return row.wonAtExact ? date : `${date} (${dict.wonCompaniesDialogWonAtApprox})`;
}

/**
 * "Empresas ganadas" KPI (reports-bd-filter-drilldown, owner request): the
 * card becomes a clickable trigger once its value is >= 1, opening a Dialog
 * with the current won-companies list. BD-filtered only, deliberately
 * ignoring the page's period filter — see
 * src/lib/reports/wonCompaniesDrilldown.ts's doc comment.
 */
export function WonCompaniesKpiCard({
  value,
  foot,
  bdId,
}: {
  value: number;
  foot: React.ReactNode;
  bdId: string | null;
}) {
  return (
    <KpiDrilldownCard<WonCompanyDrilldownRow>
      toneClass="warn"
      label={dict.kpiCompaniesWon}
      value={value}
      foot={foot}
      dialogTitle={dict.wonCompaniesDialogTitle}
      dialogSubtitle={dict.wonCompaniesDialogSubtitle}
      closeLabel={dict.dialogClose}
      loadingLabel={dict.dialogLoading}
      errorLabel={dict.dialogError}
      fetchRows={() => getWonCompaniesDrilldownAction(bdId)}
      renderList={(rows) =>
        rows.length === 0 ? (
          <p className="meta">{dict.wonCompaniesDialogEmpty}</p>
        ) : (
          <>
            <table className="data compact">
              <thead>
                <tr>
                  <th>{dict.wonCompaniesDialogColCompany}</th>
                  <th>{dict.wonCompaniesDialogColOwner}</th>
                  <th className="right">{dict.wonCompaniesDialogColWonAt}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.companyKey}>
                    <td>
                      <Link href={`/companies/${encodeURIComponent(row.companyKey)}`}>{row.displayName}</Link>
                    </td>
                    <td>{row.ownerBdName ?? dict.wonCompaniesDialogNoOwner}</td>
                    <td className="right num">{wonAtText(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="meta mt-md">{dict.wonCompaniesDialogFootnote}</p>
          </>
        )
      }
    />
  );
}

"use server";

/**
 * On-demand drilldown reads for the "Empresas ganadas"/"Reuniones agendadas"
 * KPI dialogs (reports-bd-filter-drilldown) and the cohort lists behind
 * "Tasa de respuesta"/the funnel rows (reports-kpi-drilldown). Admin-gated like every other
 * /admin/reports read; never invoked on page load (KpiDrilldownCard.tsx
 * calls these only when the dialog is first opened), so this adds no round
 * trip to the page's own 2 statements (PERFORMANCE.md).
 */
import { unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { isUuid } from "@/lib/uuid";
import { getCohortDrilldown, getMeetingsDrilldown, getWonCompaniesDrilldown } from "@/lib/reports/queriesDb";
import { isValidReportWindow } from "@/lib/reports/period";
import { isCohortPopulation, type CohortRow } from "@/lib/reports/cohortDrilldown";
import type { MeetingDrilldownRow } from "@/lib/reports/meetingsDrilldown";
import type { WonCompanyDrilldownRow } from "@/lib/reports/wonCompaniesDrilldown";

type DrilldownResult<T> = { ok: true; rows: T[] } | { ok: false };

function normalizedBdId(bdId: string | null): string | null {
  return bdId && isUuid(bdId) ? bdId : null;
}

export async function getWonCompaniesDrilldownAction(params: {
  fromIso: string;
  toIso: string;
  bdId: string | null;
}): Promise<DrilldownResult<WonCompanyDrilldownRow>> {
  try {
    await requireAdmin();
    if (!isValidReportWindow(params.fromIso, params.toIso)) return { ok: false };
    const rows = await getWonCompaniesDrilldown({ fromIso: params.fromIso, toIso: params.toIso, bdId: normalizedBdId(params.bdId) });
    return { ok: true, rows };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[reports] getWonCompaniesDrilldownAction failed", err);
    return { ok: false };
  }
}

export async function getMeetingsDrilldownAction(params: {
  fromIso: string;
  toIso: string;
  bdId: string | null;
}): Promise<DrilldownResult<MeetingDrilldownRow>> {
  try {
    await requireAdmin();
    if (!isValidReportWindow(params.fromIso, params.toIso)) return { ok: false };
    const rows = await getMeetingsDrilldown({
      fromIso: params.fromIso,
      toIso: params.toIso,
      bdId: normalizedBdId(params.bdId),
    });
    return { ok: true, rows };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[reports] getMeetingsDrilldownAction failed", err);
    return { ok: false };
  }
}

export async function getCohortDrilldownAction(params: {
  population: string;
  fromIso: string;
  toIso: string;
  bdId: string | null;
}): Promise<DrilldownResult<CohortRow>> {
  try {
    await requireAdmin();
    if (!isCohortPopulation(params.population) || !isValidReportWindow(params.fromIso, params.toIso)) {
      return { ok: false };
    }
    const rows = await getCohortDrilldown({
      population: params.population,
      fromIso: params.fromIso,
      toIso: params.toIso,
      bdId: normalizedBdId(params.bdId),
    });
    return { ok: true, rows };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[reports] getCohortDrilldownAction failed", err);
    return { ok: false };
  }
}

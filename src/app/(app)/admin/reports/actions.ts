"use server";

/**
 * On-demand drilldown reads for the "Empresas ganadas"/"Reuniones agendadas"
 * KPI dialogs (reports-bd-filter-drilldown). Admin-gated like every other
 * /admin/reports read; never invoked on page load (KpiDrilldownCard.tsx
 * calls these only when the dialog is first opened), so this adds no round
 * trip to the page's own 2 statements (PERFORMANCE.md).
 */
import { unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { isUuid } from "@/lib/uuid";
import { getMeetingsDrilldown, getWonCompaniesDrilldown } from "@/lib/reports/queriesDb";
import type { MeetingDrilldownRow } from "@/lib/reports/meetingsDrilldown";
import type { WonCompanyDrilldownRow } from "@/lib/reports/wonCompaniesDrilldown";

type DrilldownResult<T> = { ok: true; rows: T[] } | { ok: false };

function normalizedBdId(bdId: string | null): string | null {
  return bdId && isUuid(bdId) ? bdId : null;
}

export async function getWonCompaniesDrilldownAction(bdId: string | null): Promise<DrilldownResult<WonCompanyDrilldownRow>> {
  try {
    await requireAdmin();
    const rows = await getWonCompaniesDrilldown({ bdId: normalizedBdId(bdId) });
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

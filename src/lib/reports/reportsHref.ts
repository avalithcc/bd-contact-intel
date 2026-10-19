/**
 * Pure `/admin/reports?period=...&bd=...` URL builder — extracted out of
 * ReportsView.tsx (a server component) so BdFilterSelect.tsx (a CLIENT
 * component, reports-bd-filter-drilldown fix) can import it without pulling
 * ReportsView's own server-only imports (next/link, the full es dictionary)
 * into the client bundle.
 */
import type { CustomRange, ReportPeriod } from "@/lib/reports/period";

export function buildReportsHref(period: ReportPeriod, bdId: string | null, custom?: CustomRange | null): string {
  const params = new URLSearchParams();
  if (period !== "month") params.set("period", period);
  if (period === "custom" && custom) {
    params.set("from", custom.from);
    params.set("to", custom.to);
  }
  if (bdId) params.set("bd", bdId);
  const qs = params.toString();
  return qs ? `/admin/reports?${qs}` : "/admin/reports";
}

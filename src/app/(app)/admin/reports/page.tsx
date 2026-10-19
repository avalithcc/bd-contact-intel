import { notFound } from "next/navigation";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { isUuid } from "@/lib/uuid";
import { parseCustomRange, reportPeriodRange, resolveReportPeriod } from "@/lib/reports/period";
import { getReportAggregates, getReportPerBd } from "@/lib/reports/queriesDb";
import { ReportsView } from "./ReportsView";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; bd?: string; from?: string; to?: string }>;
}) {
  try {
    await requireAdmin();
  } catch (err) {
    // Admin screens 404 for non-admins (design.md "Routes"), same gate as
    // /admin/duplicates and /admin/migration (owner-reporting decision 1).
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }

  const sp = await searchParams;
  // A "custom" period without a valid from/to pair falls back to the month, like an unknown period.
  const custom = parseCustomRange(sp.from, sp.to);
  const period = sp.period === "custom" && !custom ? "month" : resolveReportPeriod(sp.period);
  const bdId = sp.bd && sp.bd !== "all" && isUuid(sp.bd) ? sp.bd : null;
  const range = reportPeriodRange(period, new Date(), custom);

  // Exactly 2 round trips for the whole page (PERFORMANCE.md) — these two
  // statements have unrelated result shapes (one JSON row vs. N per-BD
  // rows), so they cannot be combined into one without a fan-out; a
  // sequential await here costs the same 2 round trips a `Promise.all`
  // would (PERFORMANCE.md: "does this remove round trips, or just reorder
  // them?"), so this stays sequential rather than implying a speedup that
  // isn't real.
  const aggregates = await getReportAggregates({ fromIso: range.fromIso, toIso: range.toIso, scheduledToIso: range.endIso, bdId });
  const perBd = await getReportPerBd({
    fromIso: range.fromIso,
    toIso: range.toIso,
    fromDate: range.fromDate,
    toDateExclusive: range.toDateExclusive,
    bdId,
  });

  return <ReportsView period={period} bdId={bdId} custom={custom} range={range} aggregates={aggregates} perBd={perBd} />;
}

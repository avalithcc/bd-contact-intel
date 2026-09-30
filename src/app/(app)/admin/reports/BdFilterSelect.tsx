"use client";

import { useRouter } from "next/navigation";
import { buildReportsHref } from "@/lib/reports/reportsHref";
import type { ReportPeriod } from "@/lib/reports/period";

/**
 * Bug fix (owner report 2026-09-30: "when I select a BD, the report
 * doesn't change"): the `<select>` used to sit in a plain `<form>` whose
 * only trigger was the "Aplicar" submit button below it — easy to miss, so
 * picking a BD visibly did nothing until that separate click. Same
 * `router.push(href)`-on-change pattern as
 * src/app/(app)/whats-new/FilterCheckbox.tsx: selecting a BD navigates
 * immediately, no second click needed.
 *
 * Still rendered with `name="bd"` inside ReportsView's own `<form>`, so the
 * `<noscript>`-only "Aplicar" button next to it (ReportsView.tsx) keeps
 * working as a real submit for a no-JS visitor — this component only adds
 * the JS-enabled shortcut, it never removes the native form behavior.
 */
export function BdFilterSelect({
  period,
  bdId,
  options,
  allLabel,
}: {
  period: ReportPeriod;
  bdId: string | null;
  options: { id: string; name: string }[];
  allLabel: string;
}) {
  const router = useRouter();

  return (
    <select
      id="bd-filter"
      name="bd"
      className="select input-sm"
      defaultValue={bdId ?? "all"}
      onChange={(e) => router.push(buildReportsHref(period, e.target.value === "all" ? null : e.target.value))}
    >
      <option value="all">{allLabel}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
